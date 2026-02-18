package com.mlbDashboard

import akka.actor.ActorSystem
import akka.http.scaladsl.Http
import akka.http.scaladsl.marshallers.sprayjson.SprayJsonSupport._
import akka.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import akka.http.scaladsl.server.Directives._
import akka.http.scaladsl.server.Route
import spray.json.DefaultJsonProtocol._
import spray.json.{RootJsonFormat, enrichAny}

import scala.concurrent.Future
import scala.concurrent.ExecutionContextExecutor
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

case class ErrorResponse(error: String)


object ErrorResponse {
  implicit val format: RootJsonFormat[ErrorResponse] = jsonFormat1(ErrorResponse.apply)
}

class Server {

  implicit val system: ActorSystem = ActorSystem("api-system")
  implicit val ec: ExecutionContextExecutor = system.dispatcher

  private val pythonPath: String = sys.env.getOrElse("PYTHON_PATH", ".venv/bin/python")
  private val scriptPath: String = sys.env.getOrElse("MLB_API_SCRIPT", "src/main/python/run_mlb_api.py")
  private val projectRoot: String = new File(".").getAbsolutePath
  private val allowedOrigin: String = sys.env.getOrElse("ALLOWED_ORIGIN", "http://localhost:5800")

  // Rate limiting: max requests per IP within the time window
  private val rateLimitMax: Int = 30
  private val rateLimitWindowMs: Long = 60000L // 1 minute

  private case class RateBucket(count: AtomicLong = new AtomicLong(0), windowStart: AtomicLong = new AtomicLong(System.currentTimeMillis()))
  private val rateLimitMap = new ConcurrentHashMap[String, RateBucket]()

  // Periodically clean up stale entries
  system.scheduler.scheduleWithFixedDelay(
    scala.concurrent.duration.Duration(5, TimeUnit.MINUTES),
    scala.concurrent.duration.Duration(5, TimeUnit.MINUTES)
  )(() => {
    val now = System.currentTimeMillis()
    rateLimitMap.forEach { (ip, bucket) =>
      if (now - bucket.windowStart.get() > rateLimitWindowMs * 2) rateLimitMap.remove(ip)
    }
  })

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

  private def corsHeaders = respondWithHeaders(
    akka.http.scaladsl.model.headers.RawHeader("Access-Control-Allow-Origin", allowedOrigin),
    akka.http.scaladsl.model.headers.RawHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS"),
    akka.http.scaladsl.model.headers.RawHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  )

  private def executePythonScript(body: String): Future[String] = Future {
    var process: Process = null
    try {
      val pb = new java.lang.ProcessBuilder(pythonPath, scriptPath)
      pb.directory(new File(projectRoot))
      process = pb.start()

      val os = process.getOutputStream
      try {
        os.write(body.getBytes("UTF-8"))
      } finally {
        os.close()
      }

      val completed = process.waitFor(30, TimeUnit.SECONDS)

      if (!completed) {
        process.destroyForcibly()
        ErrorResponse("Request timed out. Please try again.").toJson.compactPrint
      } else {
        val output = scala.io.Source.fromInputStream(process.getInputStream).mkString
        val error = scala.io.Source.fromInputStream(process.getErrorStream).mkString

        if (error.nonEmpty) {
          system.log.error("Python script stderr: {}", error.trim)
          ErrorResponse("An internal error occurred. Please try again later.").toJson.compactPrint
        }
        else if (output.isEmpty) ErrorResponse("No output from script").toJson.compactPrint
        else output
      }
    } catch {
      case e: Exception =>
        system.log.error("Error executing Python script: {}", e.getMessage)
        ErrorResponse("An internal error occurred. Please try again later.").toJson.compactPrint
    } finally {
      if (process != null) {
        process.destroy()
      }
    }
  }

  val route: Route =
    corsHeaders {
      path("api" / "player") {
        options {
          complete("")
        } ~
        post {
          extractClientIP { remoteAddr =>
            val ip = remoteAddr.toOption.map(_.getHostAddress).getOrElse("unknown")
            if (!checkRateLimit(ip)) {
              complete(StatusCodes.TooManyRequests -> HttpEntity(ContentTypes.`application/json`,
                ErrorResponse("Rate limit exceeded. Please wait before making more requests.").toJson.compactPrint))
            } else {
              withSizeLimit(8192) {
                entity(as[String]) { body =>
                  complete(executePythonScript(body).map(json => HttpEntity(ContentTypes.`application/json`, json)))
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
    }

  private val port: Int = sys.env.getOrElse("PORT", "5800").toInt
  Http().newServerAt("0.0.0.0", port).bind(route)
}