ThisBuild / organization := "com.mlbDashboard"
ThisBuild / version := "0.1.0"
ThisBuild / scalaVersion := "2.13.12"

name := "mlbdashboard"

enablePlugins(JavaAppPackaging)

libraryDependencies ++= Seq(
  "com.typesafe.akka" %% "akka-actor" % "2.8.5",
  "com.typesafe.akka" %% "akka-http" % "10.5.3",
  "com.typesafe.akka" %% "akka-stream" % "2.8.5",
  "com.typesafe.akka" %% "akka-http-spray-json" % "10.5.3",
  "io.spray" %% "spray-json" % "1.3.6"
)

// Set Main as the default class to run
Compile / mainClass := Some("com.mlbDashboard.Main")

// Fork a new JVM for running to properly apply javaOptions
fork := true

javaOptions += "--enable-native-access=ALL-UNNAMED"