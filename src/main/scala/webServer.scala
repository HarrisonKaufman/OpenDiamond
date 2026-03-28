package com.mlbDashboard

import akka.actor.ActorSystem
import akka.http.scaladsl.Http
import akka.http.scaladsl.marshallers.sprayjson.SprayJsonSupport._
import akka.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, StatusCodes}
import akka.http.scaladsl.server.Directives._
import akka.http.scaladsl.server.Route
import spray.json.DefaultJsonProtocol._
import spray.json.{RootJsonFormat, enrichAny}

import scala.concurrent.Future
import scala.concurrent.ExecutionContextExecutor
import scala.concurrent.blocking
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.util.UUID

case class ErrorResponse(error: String)


object ErrorResponse {
  implicit val format: RootJsonFormat[ErrorResponse] = jsonFormat1(ErrorResponse.apply)
}

class Server {

  implicit val system: ActorSystem = ActorSystem("api-system")
  implicit val ec: ExecutionContextExecutor = system.dispatcher

  private val projectRoot: String = new File(".").getAbsolutePath
  
  private val pythonPath: String = {
    val configuredPath = sys.env.getOrElse("PYTHON_PATH", "python3")
    // Only validate as file if it's an absolute path
    if (configuredPath.startsWith("/")) {
      val file = new File(configuredPath)
      if (!file.exists() || !file.isFile) {
        throw new SecurityException(s"Invalid PYTHON_PATH: $configuredPath")
      }
    }
    configuredPath
  }
  
  private val scriptPath: String = {
    val scriptFile = new File(projectRoot, "src/main/python/run_mlb_api.py").getAbsolutePath
    if (!scriptFile.startsWith(new File(projectRoot).getAbsolutePath)) {
      throw new SecurityException("Script path escapes project root")
    }
    if (!new File(scriptFile).exists()) {
      throw new SecurityException(s"Script file not found: $scriptFile")
    }
    scriptFile
  }
  
  private val allowedOrigins: Set[String] = 
    sys.env.getOrElse("ALLOWED_ORIGINS", "http://localhost:5800,http://localhost:3000")
      .split(",").map(_.trim).filter(_.nonEmpty).toSet
  
  private val rateLimitMax: Int = 30
  private val rateLimitWindowMs: Long = 60000L
  private val csrfTokenTtlMs: Long = 3600000L

  private case class RateBucket(count: AtomicLong = new AtomicLong(0), windowStart: AtomicLong = new AtomicLong(System.currentTimeMillis()))
  private case class CsrfToken(token: String, clientIp: String, createdAt: Long)
  
  private val rateLimitMap = new ConcurrentHashMap[String, RateBucket]()
  private val csrfTokens = new ConcurrentHashMap[String, CsrfToken]()

  system.scheduler.scheduleWithFixedDelay(
    scala.concurrent.duration.Duration(5, TimeUnit.MINUTES),
    scala.concurrent.duration.Duration(5, TimeUnit.MINUTES)
  )(() => {
    val now = System.currentTimeMillis()
    rateLimitMap.forEach { (ip, bucket) =>
      if (now - bucket.windowStart.get() > rateLimitWindowMs * 2) rateLimitMap.remove(ip)
    }
    csrfTokens.forEach { (token, entry) =>
      if (now - entry.createdAt > csrfTokenTtlMs) csrfTokens.remove(token)
    }
  })

  private def getClientIp(request: HttpRequest): String = {
    request.headers.find(_.name.equalsIgnoreCase("X-Forwarded-For"))
      .map(_.value.split(",").head.trim)
      .orElse(request.headers.find(_.name.equalsIgnoreCase("X-Real-IP")).map(_.value))
      .getOrElse("unknown")
  }

  private def generateCsrfToken(clientIp: String): String = {
    val token = UUID.randomUUID().toString.replace("-", "")
    csrfTokens.put(token, CsrfToken(token, clientIp, System.currentTimeMillis()))
    token
  }

  private def validateCsrfToken(token: String, clientIp: String): Boolean = {
    csrfTokens.get(token) match {
      case entry: CsrfToken if entry != null =>
        val now = System.currentTimeMillis()
        val isValid = entry.clientIp == clientIp && (now - entry.createdAt) < csrfTokenTtlMs
        if (isValid) csrfTokens.remove(token)
        isValid
      case _ => false
    }
  }

  private def corsHeaders(originHeader: Option[String]) = {
    val origin = originHeader.getOrElse("unknown")
    val baseHeaders = Seq(
      akka.http.scaladsl.model.headers.RawHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains"),
      akka.http.scaladsl.model.headers.RawHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' cdn.jsdelivr.net; font-src 'self' cdn.jsdelivr.net; connect-src 'self' statsapi.mlb.com localhost:*; img-src 'self' data:; frame-ancestors 'none'"),
      akka.http.scaladsl.model.headers.RawHeader("X-Content-Type-Options", "nosniff"),
      akka.http.scaladsl.model.headers.RawHeader("X-Frame-Options", "DENY")
    )
    
    if (allowedOrigins.contains(origin)) {
      val allHeaders = baseHeaders ++ Seq(
        akka.http.scaladsl.model.headers.RawHeader("Access-Control-Allow-Origin", origin),
        akka.http.scaladsl.model.headers.RawHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
        akka.http.scaladsl.model.headers.RawHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token"),
        akka.http.scaladsl.model.headers.RawHeader("Access-Control-Max-Age", "3600")
      )
      respondWithHeaders(allHeaders.toList)
    } else {
      respondWithHeaders(baseHeaders.toList)
    }
  }

  private def checkRateLimit(ip: String): Boolean = {
    val now = System.currentTimeMillis()
    val bucket = rateLimitMap.computeIfAbsent(ip, _ => RateBucket())
    if (now - bucket.windowStart.get() > rateLimitWindowMs) {
      bucket.windowStart.set(now)
      bucket.count.set(1)
      true
    } else {
      bucket.count.incrementAndGet() <= rateLimitMax
    }
  }

  private def validateTeamId(teamId: Int): Boolean = teamId > 0 && teamId <= 500

  private def validateYear(year: Int): Boolean = year >= 1900 && year <= 2100

  private def isValidJson(body: String): Boolean = {
    try {
      spray.json.JsonParser(body)
      true
    } catch {
      case _: Exception => false
    }
  }

  private def executePythonScript(body: String): Future[String] = Future {
    var process: Process = null
    var outputFile: File = null
    var errorFile: File = null
    
    try {
      blocking {
        outputFile = File.createTempFile("mlb_api_out_", ".txt")
        errorFile = File.createTempFile("mlb_api_err_", ".txt")
        
        val pb = new java.lang.ProcessBuilder(pythonPath, scriptPath)
        pb.directory(new File(projectRoot))
        pb.redirectOutput(outputFile)
        pb.redirectError(errorFile)
        
        process = pb.start()

        val os = process.getOutputStream
        try {
          os.write(body.getBytes("UTF-8"))
        } finally {
          os.close()
        }

        val completed = process.waitFor(120, TimeUnit.SECONDS)

        if (!completed) {
          process.destroyForcibly()
          system.log.error("Python script execution exceeded 120 second timeout")
          ErrorResponse("Request timed out. Please try again.").toJson.compactPrint
        } else {
          val exitCode = process.exitValue()
          
          val output = scala.io.Source.fromFile(outputFile).mkString
          val error = scala.io.Source.fromFile(errorFile).mkString

          val hasRealError = error.contains("Traceback") || error.contains("Error:") || error.contains("Exception")

          if (hasRealError) {
            system.log.error("Python script error: {}", error.trim)
            ErrorResponse("Python script error: " + error.trim).toJson.compactPrint
          }
          else if (output.isEmpty) {
            system.log.error("No output from Python script")
            ErrorResponse("No output from script").toJson.compactPrint
          }
          else {
            system.log.info("Successfully executed Python script, returned {} bytes", output.length)
            output
          }
        }
      }
    } catch {
      case e: Exception =>
        system.log.error("Error executing Python script: {}", e.getMessage)
        ErrorResponse("An internal error occurred. Please try again later.").toJson.compactPrint
    } finally {
      if (process != null) {
        process.destroy()
      }
      if (outputFile != null && outputFile.exists()) outputFile.delete()
      if (errorFile != null && errorFile.exists()) errorFile.delete()
    }
  }

  val route: Route =
    path("api" / "csrf-token") {
      options {
        complete("")
      } ~
      get {
        extractClientIP { remoteAddr =>
          extractRequest { request =>
            val originHeader = request.headers.find(_.name.equalsIgnoreCase("Origin")).map(_.value)
            corsHeaders(originHeader) {
              val clientIp = request.headers.find(_.name.equalsIgnoreCase("X-Forwarded-For"))
                .map(_.value.split(",").head.trim)
                .orElse(request.headers.find(_.name.equalsIgnoreCase("X-Real-IP")).map(_.value))
                .getOrElse(remoteAddr.toOption.map(_.getHostAddress).getOrElse("unknown"))
              if (!checkRateLimit(clientIp)) {
                complete(StatusCodes.TooManyRequests -> HttpEntity(ContentTypes.`application/json`,
                  ErrorResponse("Rate limit exceeded. Please wait before making more requests.").toJson.compactPrint))
              } else {
                val token = generateCsrfToken(clientIp)
                complete(HttpEntity(ContentTypes.`application/json`, s"""{"csrfToken":"$token"}"""))
              }
            }
          }
        }
      }
    } ~
    path("api" / "player") {
      options {
        complete("")
      } ~
      post {
        extractClientIP { remoteAddr =>
          extractRequest { request =>
            val originHeader = request.headers.find(_.name.equalsIgnoreCase("Origin")).map(_.value)
            corsHeaders(originHeader) {
              val clientIp = request.headers.find(_.name.equalsIgnoreCase("X-Forwarded-For"))
                .map(_.value.split(",").head.trim)
                .orElse(request.headers.find(_.name.equalsIgnoreCase("X-Real-IP")).map(_.value))
                .getOrElse(remoteAddr.toOption.map(_.getHostAddress).getOrElse("unknown"))
              if (!checkRateLimit(clientIp)) {
                complete(StatusCodes.TooManyRequests -> HttpEntity(ContentTypes.`application/json`,
                  ErrorResponse("Rate limit exceeded. Please wait before making more requests.").toJson.compactPrint))
              } else {
                withSizeLimit(1024) {
                  entity(as[String]) { body =>
                    if (!isValidJson(body)) {
                      complete(StatusCodes.BadRequest -> HttpEntity(ContentTypes.`application/json`,
                        ErrorResponse("Invalid JSON").toJson.compactPrint))
                    } else {
                      val csrfToken = request.headers.find(_.name.equalsIgnoreCase("X-CSRF-Token")).map(_.value)
                      if (csrfToken.isEmpty || !validateCsrfToken(csrfToken.get, clientIp)) {
                        complete(StatusCodes.Forbidden -> HttpEntity(ContentTypes.`application/json`,
                          ErrorResponse("Invalid CSRF token").toJson.compactPrint))
                      } else {
                        complete(executePythonScript(body).map(json => HttpEntity(ContentTypes.`application/json`, json)))
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } ~
    path("api" / "teams") {
      options {
        complete("")
      } ~
      get {
        extractClientIP { remoteAddr =>
          extractRequest { request =>
            val originHeader = request.headers.find(_.name.equalsIgnoreCase("Origin")).map(_.value)
            corsHeaders(originHeader) {
              val clientIp = request.headers.find(_.name.equalsIgnoreCase("X-Forwarded-For"))
                .map(_.value.split(",").head.trim)
                .orElse(request.headers.find(_.name.equalsIgnoreCase("X-Real-IP")).map(_.value))
                .getOrElse(remoteAddr.toOption.map(_.getHostAddress).getOrElse("unknown"))
              if (!checkRateLimit(clientIp)) {
                complete(StatusCodes.TooManyRequests -> HttpEntity(ContentTypes.`application/json`,
                  ErrorResponse("Rate limit exceeded. Please wait before making more requests.").toJson.compactPrint))
              } else {
                val teamsListRequest = """{"action": "teams"}"""
                complete(executePythonScript(teamsListRequest).map(json => HttpEntity(ContentTypes.`application/json`, json)))
              }
            }
          }
        }
      } ~
      post {
        extractClientIP { remoteAddr =>
          extractRequest { request =>
            val originHeader = request.headers.find(_.name.equalsIgnoreCase("Origin")).map(_.value)
            corsHeaders(originHeader) {
              val clientIp = request.headers.find(_.name.equalsIgnoreCase("X-Forwarded-For"))
                .map(_.value.split(",").head.trim)
                .orElse(request.headers.find(_.name.equalsIgnoreCase("X-Real-IP")).map(_.value))
                .getOrElse(remoteAddr.toOption.map(_.getHostAddress).getOrElse("unknown"))
              if (!checkRateLimit(clientIp)) {
                complete(StatusCodes.TooManyRequests -> HttpEntity(ContentTypes.`application/json`,
                  ErrorResponse("Rate limit exceeded. Please wait before making more requests.").toJson.compactPrint))
              } else {
                withSizeLimit(1024) {
                  entity(as[String]) { body =>
                    if (!isValidJson(body)) {
                      complete(StatusCodes.BadRequest -> HttpEntity(ContentTypes.`application/json`,
                        ErrorResponse("Invalid JSON").toJson.compactPrint))
                    } else {
                      val csrfToken = request.headers.find(_.name.equalsIgnoreCase("X-CSRF-Token")).map(_.value)
                      if (csrfToken.isEmpty || !validateCsrfToken(csrfToken.get, clientIp)) {
                        complete(StatusCodes.Forbidden -> HttpEntity(ContentTypes.`application/json`,
                          ErrorResponse("Invalid CSRF token").toJson.compactPrint))
                      } else {
                        complete(executePythonScript(body).map(json => HttpEntity(ContentTypes.`application/json`, json)))
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } ~
    path("api" / "teams" / IntNumber) { teamId =>
      options {
        complete("")
      } ~
      get {
        parameters('year.as[Int].?) { yearOpt =>
          extractClientIP { remoteAddr =>
            extractRequest { request =>
              val originHeader = request.headers.find(_.name.equalsIgnoreCase("Origin")).map(_.value)
              corsHeaders(originHeader) {
                if (!validateTeamId(teamId)) {
                  complete(StatusCodes.BadRequest -> HttpEntity(ContentTypes.`application/json`,
                    ErrorResponse("Invalid team ID").toJson.compactPrint))
                } else if (yearOpt.isDefined && !validateYear(yearOpt.get)) {
                  complete(StatusCodes.BadRequest -> HttpEntity(ContentTypes.`application/json`,
                    ErrorResponse("Invalid year").toJson.compactPrint))
                } else {
                  val clientIp = request.headers.find(_.name.equalsIgnoreCase("X-Forwarded-For"))
                    .map(_.value.split(",").head.trim)
                    .orElse(request.headers.find(_.name.equalsIgnoreCase("X-Real-IP")).map(_.value))
                    .getOrElse(remoteAddr.toOption.map(_.getHostAddress).getOrElse("unknown"))
                  if (!checkRateLimit(clientIp)) {
                    complete(StatusCodes.TooManyRequests -> HttpEntity(ContentTypes.`application/json`,
                      ErrorResponse("Rate limit exceeded. Please wait before making more requests.").toJson.compactPrint))
                  } else {
                    val request = yearOpt match {
                      case Some(year) => s"""{"action": "team_data", "teamId": $teamId, "season": $year}"""
                      case None => s"""{"action": "team_data", "teamId": $teamId}"""
                    }
                    complete(executePythonScript(request).map(json => HttpEntity(ContentTypes.`application/json`, json)))
                  }
                }
              }
            }
          }
        }
      }
    } ~
    path("api" / "teams" / IntNumber / "years") { teamId =>
      options {
        complete("")
      } ~
      get {
        extractClientIP { remoteAddr =>
          extractRequest { request =>
            val originHeader = request.headers.find(_.name.equalsIgnoreCase("Origin")).map(_.value)
            corsHeaders(originHeader) {
              if (!validateTeamId(teamId)) {
                complete(StatusCodes.BadRequest -> HttpEntity(ContentTypes.`application/json`,
                  ErrorResponse("Invalid team ID").toJson.compactPrint))
              } else {
                val clientIp = request.headers.find(_.name.equalsIgnoreCase("X-Forwarded-For"))
                  .map(_.value.split(",").head.trim)
                  .orElse(request.headers.find(_.name.equalsIgnoreCase("X-Real-IP")).map(_.value))
                  .getOrElse(remoteAddr.toOption.map(_.getHostAddress).getOrElse("unknown"))
                if (!checkRateLimit(clientIp)) {
                  complete(StatusCodes.TooManyRequests -> HttpEntity(ContentTypes.`application/json`,
                    ErrorResponse("Rate limit exceeded. Please wait before making more requests.").toJson.compactPrint))
                } else {
                  val yearsRequest = s"""{"action": "team_years", "teamId": $teamId}"""
                  complete(executePythonScript(yearsRequest).map(json => HttpEntity(ContentTypes.`application/json`, json)))
                }
              }
            }
          }
        }
      }
    } ~
    path("api" / "teams" / IntNumber / "history") { teamId =>
      options {
        complete("")
      } ~
      get {
        extractClientIP { remoteAddr =>
          extractRequest { request =>
            val originHeader = request.headers.find(_.name.equalsIgnoreCase("Origin")).map(_.value)
            corsHeaders(originHeader) {
              if (!validateTeamId(teamId)) {
                complete(StatusCodes.BadRequest -> HttpEntity(ContentTypes.`application/json`,
                  ErrorResponse("Invalid team ID").toJson.compactPrint))
              } else {
                val clientIp = request.headers.find(_.name.equalsIgnoreCase("X-Forwarded-For"))
                  .map(_.value.split(",").head.trim)
                  .orElse(request.headers.find(_.name.equalsIgnoreCase("X-Real-IP")).map(_.value))
                  .getOrElse(remoteAddr.toOption.map(_.getHostAddress).getOrElse("unknown"))
                if (!checkRateLimit(clientIp)) {
                  complete(StatusCodes.TooManyRequests -> HttpEntity(ContentTypes.`application/json`,
                    ErrorResponse("Rate limit exceeded. Please wait before making more requests.").toJson.compactPrint))
                } else {
                  val historyRequest = s"""{"action": "team_history", "teamId": $teamId}"""
                  complete(executePythonScript(historyRequest).map(json => HttpEntity(ContentTypes.`application/json`, json)))
                }
              }
            }
          }
        }
      }
    } ~
    path("") {
      getFromFile("src/main/front/pages/home.html")
    } ~
    path("players") {
      getFromFile("src/main/front/pages/players.html")
    } ~
    path("games") {
      getFromFile("src/main/front/pages/games.html")
    } ~
    path("teams") {
      getFromFile("src/main/front/pages/teams.html")
    } ~
    getFromDirectory("src/main/front")

  private val port: Int = sys.env.getOrElse("PORT", "5800").toInt
  Http().newServerAt("0.0.0.0", port).bind(route)
}