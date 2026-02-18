package com.mlbDashboard

object Main extends App {
  val server = new Server()
  ShutHandler.registerShutdownHook(server.system)

  println("MLB Dashboard initialized")
}