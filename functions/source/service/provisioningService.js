'use strict';

const AWS = require("aws-sdk")
const request = require("request-promise-native")
const provisioningKeyRepository = require('../repository/provisioningKeyRepository')

class ProvisioningService {

  constructor() {
    this._iot = new AWS.Iot()
    this._iam = new AWS.IAM()
    this._kinesisStream = new AWS.Kinesis()
    this._cloudwatch = new AWS.CloudWatch()
  }

  async authorize(provisioningKey) {
    if (!provisioningKey) {
      console.log("Missing provisioning key.")
      return false
    }
    const authorized = await provisioningKeyRepository.existsProvisioningKey(provisioningKey)
    if (!authorized) {
      console.log("Provisioning key is invalid.")
    }
    return authorized
  }

  async provisionThing(id, metaData) {
    //unique id is the thing name.
    const thingName = id

    // TBD what to do if thing already exists. reprovisioning it works fine
    // and may be desired anyway e.g. if camera is in some kind of error state.
    try {
      const existingThing = await this._iot.describeThing({thingName}).promise()
      console.log(`WARN: Thing ${thingName} already exists.`)
      console.log(existingThing)
    } catch (err) {
      //Ignore ResourceNotFoundException
    }

    //create thing
    const thing = await this._iot.createThing({thingName}).promise()

    //create cert
    const keys = await this._iot.createKeysAndCertificate({setAsActive: true}).promise()

    //associate certificate with thing
    const principal = keys.certificateArn
    const attachThingPrincipal = await this._iot.attachThingPrincipal({thingName, principal}).promise()

    //associate iot policy
    const policyName = process.env.IoTCameraPolicyName
    const target = keys.certificateArn
    const attachPolicy = await this._iot.attachPolicy({ policyName, target }).promise()

    //iot data endpoint
    const dataEndpoint = await this._iot.describeEndpoint({endpointType: "iot:Data"}).promise()
    const IoTEndpointUrl = dataEndpoint.endpointAddress

    //iot ca
    const IoTCACert = await request({method: "GET", url: "https://www.amazontrust.com/repository/AmazonRootCA1.pem"})

    //iot credential endpoint for role alias
    const credentialEndpoint = await this._iot.describeEndpoint({endpointType: "iot:CredentialProvider"}).promise()
    const IoTCredentialRoleAlias = process.env.CameraStreamingRoleAliasName
    const IoTCredentialEndpoint = `https://${credentialEndpoint.endpointAddress}`
    const IoTCredentialUrl = `${IoTCredentialEndpoint}/role-aliases/${IoTCredentialRoleAlias}/credentials`

    //create stream
    const StreamName = thingName
    try {
      const existingStream = await this._kinesisStream.describeStream({StreamName}).promise()
      console.log("Kinesis data stream already exists.")
    } catch (err) {
      //Ignore ResourceNotFoundException
      console.log("Creating kinesis data stream.")
      const kvs = await this._kinesisStream.createStream({StreamName, ShardCount: "1"}).promise()
      const existingStream = await this._kinesisStream.describeStream({StreamName}).promise()
    }

    try {
      const params = {
        TableName: process.env.MetaDataTableName,
        Item: {
          key: thingName,
          data: metaData
        }
      }

      const docClient = new AWS.DynamoDB.DocumentClient({convertEmptyValues: true})
      const result = await docClient.put(params, function(err, data) {
        if (err) console.log(err, err.stack);
      }).promise()
    } catch (err) {
      console.log("Unable to store the camera meta data")
    }

    return {
      ThingName: thingName,
      StreamName,
      Region: process.env.AWSRegion,
      IoTCertificate: keys.certificatePem,
      IoTPrivateKey: keys.keyPair.PrivateKey,
      IoTCACert,
      IoTEndpointUrl,
      IoTCredentialUrl,
      IoTCredentialEndpoint,
      IoTCredentialRoleAlias
    }
  }

  static streamAlarmParams(streamName) {
    return {
      AlarmName: ProvisioningService.streamAlarmName(streamName),
      ActionsEnabled: true,
      OKActions: [process.env.MonitoringTopicArn],
      AlarmActions: [process.env.MonitoringTopicArn],
      MetricName: "PutMedia.IncomingFrames",
      Namespace: "AWS/KinesisStream",
      Statistic: "Sum",
      Dimensions: [{
        Name: "StreamName",
        Value: streamName
      }],
      Period: 60,
      EvaluationPeriods: 1,
      DatapointsToAlarm: 1,
      Threshold: 0,
      ComparisonOperator: 'LessThanOrEqualToThreshold',
      TreatMissingData: "breaching"
    }
  }

  static streamAlarmName(streamName) {
    return `VideoStream - ${streamName}`
  }
}

module.exports = new ProvisioningService()
