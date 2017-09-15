# Predix Steam Locomotive NodeJS Simulation

## Pre-steps
* Check [Predix Status Page](https://status.predix.io/) to review any possible Predix outages.
  * If Cloud Foundry is down (or in a degraded state), you will not be able to run the setup utility in this
    submission until Cloud Foundry is available again.
  * If Time Series Service or Asset Service are down, then you will not be able to run the simulator or run the
    verification utility.

## Dependencies
* [Predix](https://www.predix.io) account is required.
* [CloudFoundry CLI](https://github.com/cloudfoundry/cli) (Tested with cf version 6.22.2+a95e24c-2016-10-27)
* [node.js v6.11.1](https://nodejs.org/en/download/releases/)
* Tested with node package manager (e.g. npm) version **4.6.1**

## Dependency Setup
* All Platforms
  * Install the Cloud Foundry CLI (refer to Dependencies section)
  * After installation, make sure you can type `cf --version` from a command prompt and not get any errors.
* OS X Specific
  * You can use the following commands to install the Cloud Foundry CLI:
    * `brew install cloudfoundry/tap/cf-cli`
* Linux
  * Refer to the dependencies for specific instructions on how to install the required software.

## Configuration
* Edit the `./config/templates/predix_config_template.json` file to set the configuration values.
  * If you are using something besides the `Free` Predix plan, modify the `predix_plan` value.
  * You can modify any of the following Predix service names if you want to use different service names (please don't
    use spaces in any of the service names):
    * `uaa_service_instance`
    * `asset_service_instance`
    * `time_series_service_instance`
  * The `client-id` and `client-secret` values are used when creating the Predix client.
    You can modify these if you want to use different values.
  * The `uaa_admin_client_secret` is the admin secret for the UAA Predix service that will be created.
    You can modify it if you want to use a different value.
  * **Important Note**
    * When the Predix services are created using the setup utility (discussed later), a `./config/predix_config.json`
      file will be generated with the service values plugged into it.
* The `./config/simulator_constants` file contains constants used by the simulator and its related utilities.
  * The `DT` value represents duration (in seconds) between each simulation step.
  * The `X1`, `X2`, and `X3` values are coefficients used in `transferFunction` calculations, such as calculating the
    new speed of the locomotive.
  * Refer to the documentation in the file for information on all the constants.

## Install node dependencies and setup Predix services
* Install node dependencies
  * `npm install`
* Setup Predix services (Be sure to check Predix status page (refer to [Pre-steps](#pre-steps)) before beginning)
  * `npm run setup`
    * When prompted, enter your Predix login ID and password. All output is generated to `./logs/setup.log` and the
      console, so if you have any issues you can refer to that file as well as the console messages.
    * Once the setup has completed, you should get a message about setup completing successfully, which means
      the Predix services are ready to use and you can run the simulator.

## Run simulator
* You can now run the simulator
  * `npm run app`

## Verify results
* You can use the verification utility to verify the results of data sent to time series and asset service.
  * `npm run verify`
    * There are options to get the data sent to time series and asset service. When you run these options, the data
      will be generated to files in the logs folder, and you can view those files to verify the data sent to Predix.

## Cleanup
* When finished testing, you can delete the services and client (client automatically gets deleted when UAA service is
  deleted) by using this command:
  * `npm run cleanup`

## Running Lint
* You can run the following command to view the lint output
  * `npm run lint`

## Next Steps
* Refer to submission_notes.txt document for important additional details.















