/*
 * Copyright (C) 2017 TopCoder Inc., All Rights Reserved.
 */
/**
 * This module contains simulator and other relevant constants used by the application.
 */

module.exports = Object.freeze({
  /**
   * The id used for the locomotive when sending data to Predix.
   */
  LOCOMOTIVE_ID: 'locomotive_topcoder',

  /**
   * The epsilon value used when comparing floating point numbers to avoid
   * precision issues.
   */
  EPS: 1e-9,

  /**
   * The number of iterations for which to run the main simulator loop.
   */
  NUM_ITERATIONS: 100000,

  /**
   * Maximum number of times we send data to Predix for each key during the simulation,
   * where a key is timeSeries, speed, or pressure.
   */
  MAX_NUM_SENDS_PER_KEY: 100,

  /**
   * Simulation time interval (in seconds) between data we send to Predix.
   */
  SEND_INTERVAL: 100,

  /**
   * Simulation step in seconds.
   */
  DT: 0.1,

  /**
   * Constant used in state transition calculations for locomotive. It is multiplied by pressure.
   */
  X1: 425205.75,

  /**
   * Constant used in state transition calculations for locomotive. It is multiplied by speed.
   */
  X2: 325000,

  /**
   * Constant used in state transition calculations for locomotive. It is used as a threshold
   * when comparing absolute value of acceleration.
   */
  X3: 1.7,

  /**
   * Amount of fuel (kg) added to tender and removed from fire chamber during each simulator iteration.
   */
  FUEL_ADD_AMT: 1.0,

  /**
   * Maximum amount of fuel (kg) allowed in fire chamber.
   */
  MAX_FUEL_MASS_IN_FIRE_CHAMBER: 10.0,

  /**
   * Value multiplied by pressure when calculating the new pressure.
   */
  PRESSURE_MULTIPLIER: 2.0,

  /**
   * Amount of fuel (kg) burned during each simulator iteration.
   */
  FUEL_BURN_AMT: 0.1,

  /**
   * The initial mass of fuel in the tender (kg).
   */
  INITIAL_FUEL_MASS_IN_TENDER: 12700,

  /**
   * Mass of the locomotive (kg).
   */
  LOCOMOTIVE_OWN_MASS: 500000.0,

  /**
   * Maximum allowed pressure (measured in bar) for the locomotive. If this pressure is exceeded, then a message will
   * be sent to Predix asset service.
   */
  MAX_ALLOWED_PRESSURE: 21.800000000007,

  /**
   * Maximum allowed speed for the locomotive in meters per second. If this speed is exceeded, then a message will
   * be sent to Predix asset service.
   */
  MAX_ALLOWED_SPEED: 27.41731,

  /**
   * The minimum allowed mass in the fuel tender.  If the amount drops below this minimum, then a message
   * will be sent to Predix asset service.
   */
  MIN_ALLOWED_FUEL_MASS_IN_TENDER: 2800,

  /**
   * Flag indicating whether logging is disabled.
   */
  DISABLE_LOGGING: false,

  /**
   * Number of seconds to wait when a Predix request fails before trying to send the request again.
   */
  WAIT_SECONDS_BETWEEN_FAILED_REQUESTS: 5,

  /**
   * Maximum number of nodes to queue for sending to Predix.
   */
  MAX_NODES_TO_QUEUE_PER_SEND: 10,

  /**
   * The logging level to use for the logger.
   */
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug',

  /**
   * The logs directory where log files will be stored.
   */
  LOGS_DIR: './logs',

  /**
   * The log interval for the simulator loop.  In other words, every LOG_INTERVAL iterations, the
   * simulator will log its state, current iteration number, and other debugging info.
   */
  LOG_INTERVAL: 500,

  /**
   * The name of the log file to use for the setup utility.
   */
  SETUP_LOGFILE_NAME: 'setup.log',

  /**
   * The name of the log file to use for the simulator.
   */
  SIMULATOR_LOGFILE_NAME: 'simulator.log',

  /**
   * The name of the log file to use for the verification utility.
   */
  VERIFICATION_LOGFILE_NAME: 'verification.log',
});

