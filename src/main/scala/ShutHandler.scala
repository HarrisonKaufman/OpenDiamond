package com.mlbDashboard

import scala.io.StdIn
import scala.concurrent.Await
import scala.concurrent.duration._
import akka.actor.ActorSystem

object ShutHandler {

  def registerShutdownHook(system: ActorSystem): Unit = {
    Runtime.getRuntime.addShutdownHook(new Thread() {
      override def run(): Unit = {
        println("Graceful shutdown initiated :) yay!")
        try {
          Await.result(system.terminate(), 10.seconds)
          println("ActorSystem terminated successfully")
        } catch {
          case e: Exception =>
            println(s"Error during shutdown: ${e.getMessage}")
            System.exit(1)
        }
      }
    })
  }
}