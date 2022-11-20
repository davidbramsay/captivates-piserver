const NodeBleHost = require('ble-host');
const BleManager = NodeBleHost.BleManager;
const AdvertisingDataBuilder = NodeBleHost.AdvertisingDataBuilder;
const HciErrors = NodeBleHost.HciErrors;
const AttErrors = NodeBleHost.AttErrors;
const HciSocket = require('hci-socket');

const struct = require('python-struct');
const base64 = require('base-64');

const fs = require('fs');

const pavlok_ids = {
    BATTERY_SERVICE_UUID: "0000180f-0000-1000-8000-00805f9b34fb",
    BATTERY_CHAR_UUID: "00002a19-0000-1000-8000-00805f9b34fb",
    MAIN_SERVICE_UUID: "156e1000-a300-4fea-897b-86f698d74461",
    MAIN_VIBRATE_CHAR_UUID: "00001001-0000-1000-8000-00805f9b34fb",
    MAIN_BEEP_CHAR_UUID: "00001002-0000-1000-8000-00805f9b34fb",
    MAIN_ZAP_CHAR_UUID: "00001003-0000-1000-8000-00805f9b34fb",
    MAIN_LED_CHAR_UUID: "00001004-0000-1000-8000-00805f9b34fb"
}

const CAPTIVATES_SERVICE_UUID = "0000fe80-8e22-4541-9d4c-21edae82ed19";
const CAPTIVATES_LED_UUID = "0000fe84-8e22-4541-9d4c-21edae82ed19";
const CAPTIVATES_RX_UUID = "0000fe81-8e22-4541-9d4c-21edae82ed19";
const CAPTIVATES_ADDRESS = '80:E1:26:24:87:8D'

const { processWatchPacket,
         constructWatchTXTimestamp,
         constructWatchTXTimeBounds,
         constructWatchTXPause
         } = require('./watchHelpers.js');

var transport = new HciSocket(); // connects to the first hci device on the computer, for example hci0

var options = {
    // optional properties go here
};

//set LED ON by default
var Gpio = require('onoff').Gpio; //include onoff to interact with the GPIO
var LED = new Gpio(4, 'out'); //use GPIO pin 4, and specify that it is output
var blinkInterval = null;

//turn LED ON after brief off (to make sure we're still controlling it)
LED.writeSync(0);
setTimeout(()=>{LED.writeSync(1);}, 250);

function blinkLED() { //function to start blinking
  if (LED.readSync() === 0) { //check the pin state, if the state is 0 (or off)
    LED.writeSync(1); //set pin state to 1 (turn LED on)
  } else {
    LED.writeSync(0); //set pin state to 0 (turn LED off)
  }
}

function startBlink() {
  blinkInterval = setInterval(blinkLED, 250); //run the blinkLED function every 250ms
}

function endBlink() { //function to stop blinking
  clearInterval(blinkInterval); // Stop blink intervals
  LED.writeSync(0); // Turn LED off
}

function blinkForNSeconds(seconds){
    startBlink();
    setTimeout(endBlink, seconds*1000); //stop blinking after 5 seconds
}


var lightState = [0,0,0,0,70,170,0,0,0,0,0,0,0,70,170,0,0,0];
var transitioning = false;
var lightTimer = null;

function resetLight(){
    let i = 170;
    let b = 70;
    lightState =   [0,0,0,0,b,i,0,0,0,0,0,0,0,b,i,0,0,0];
    sendLEDUpdate(lightState);
  }

function setLightOff(){
    this.lightState = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    sendLEDUpdate(lightState);
  }

function moveToBlue(){
    if (lightState[5] || lightState[8]){ //red or green still on

        if (lightState[4] < 170 + 50){
            lightState[4] +=1;
            lightState[13] +=1;
        }

        lightState[5] -=1;
        lightState[14] -=1;

        sendLEDUpdate(lightState);

    } else {
        console.log('ALREADY BLUE');
        dataLog('u', ['VIDGAME', 'FINISHED_TRANSITION']);
        transitioning = false;
    }
  }

function changeColor(){
      let d = new Date()
      console.log(d.toLocaleString() + ' change color called');

      if (!transitioning && 70 == lightState[4]){
          dataLog('u', ['VIDGAME', 'START_TRANSITION']);
          transitioning = true;
      }
      if (transitioning){
        moveToBlue();
        lightTimer = setTimeout(changeColor.bind(this), 500);
      }
}


var fileStreaming = false;
var writeStream = null;
var numRecords = 0;
var MAXRECORDS = 200;

function writeLineToDisk(dataArray){

    if (numRecords >= MAXRECORDS){//if we've maxed out our file
        console.log('finished writing file.');
        writeStream.end();
        writeStream = null;
        fileStreaming = false;
    }

    if (!fileStreaming){ //if we're not streaming, open file
        let x = dataArray[1];
        let datestring = x.slice(5,7) + x.slice(8,10) + x.slice(2,4) + '_' + x.slice(11,13) + x.slice(14,16) + x.slice(17,19);
        writeStream = fs.createWriteStream('data/recording_' + datestring + '.csv', {flags:'a'})

        writeStream.on('finish', function() {
            console.log('wrote to file successfully.');
        });

        writeStream.on('error', function() {
            console.error('error in file write.');
        });

        console.log('logging to file recording_' + datestring + '.csv');
        fileStreaming = true;
        numRecords = 0;
    }

    writeStream.write(dataArray.join(',') + '\n');
    numRecords += 1;
}

function dataLog(type, dataArray){
	let currentTimestamp = new Date().toISOString();
	//console.log('dataLOG:' + type + ',' + currentTimestamp + ',' + dataArray);
    console.log(currentTimestamp + ': got packet (' + type + ')');
 	return writeLineToDisk([type, currentTimestamp, ...dataArray]);
}

var x;
function sendLEDUpdate(ledArray){
    if(BLESTATE['gWrite'] != null){
      x = x || 0;
      x += 1;

      console.log(x + ': writing glasses LED ' + ledArray);

      function printResult(x, result){
        return function(result){
            console.log(x + ': ' + HciErrors.toString(result) + ' | ' + AttErrors.toString(result));
        }
      }

      function printResultBad(result){
            console.log(x + ': ' + HciErrors.toString(result) + ' | ' + AttErrors.toString(result));
      }
      function sent(){
        console.log('sent');
      }
      debugger;
      //BLESTATE['gWrite'].writeWithoutResponse(Buffer.from(bytesToHex(ledArray.slice(0)), 'hex'), sent, printResult(x));
      //BLESTATE['gWrite'].writeWithoutResponse(Buffer.from(bytesToHex(ledArray.slice(0)), 'hex'), sent, printResult(x));
      //BLESTATE['gWrite'].writeWithoutResponse(Buffer.from(bytesToHex(ledArray.slice(0)), 'hex'));
      BLESTATE['gWrite'].writeWithoutResponse(Buffer.from(ledArray.slice(0)));
      //BLESTATE['gWrite'].write(Buffer.from(bytesToHex(ledArray.slice(0)), 'hex'));
      //BLESTATE['gWrite'].writeWithoutResponse(Buffer.from(bytesToHex(ledArray.slice(0)), 'hex'), sent, printResult(x));
      //BLESTATE['gWrite'].writeWithoutResponse(Buffer.from(bytesToHex(ledArray.slice(0))), sent, printResult(x));
      //BLESTATE['gWrite'].writeWithoutResponse(Buffer.from(ledArray.slice(0)), sent, printResult(x));
      //BLESTATE['gWrite'].write(Buffer.from(ledArray.slice(0)));
        //
      //BLESTATE['gWrite'].writeWithoutResponse(Buffer.from(ledArray), sent, printResult(x));
      //BLESTATE['gWrite'].writeWithoutResponse(ledArray.slice(0), sent, printResult(x));
      //BLESTATE['gWrite'].writeWithoutResponse(bytesToHex(ledArray.slice(0)), sent, printResult(x));
      /*
      BLESTATE['gWrite'].write(Buffer.from(bytesToHex(ledArray.slice(0)), 'hex'), function(result){
      //BLESTATE['gWrite'].write(Buffer.from(ledArray.slice(0)), function(result) {
        console.log(HciErrors.toString(result));
        console.log(AttErrors.toString(result));
      });
      */
    }else{
        console.error('glasses write not connected');
    }
}

function watchSendUpdateRTC(){
    if(BLESTATE['wWrite'] != null){
        console.log('sending watch update RTC');
        BLESTATE['wWrite'].write(
            constructWatchTXTimestamp(), null);
    }else{
        console.error('watch write not connected');
    }
}


function updateWatchData(dataArray){
    if (dataArray[0].getYear() > 120 && fileOpen.current != null){ //only send data if we've synced the clock and writing
	  dataLog('w', dataArray);
	}
}


function updateGlassesData(value) {
	try{

  	var parsedPayload = struct.unpack(
                    'HHIIIIIIII',
                    value.slice(0,36));


	switch(parsedPayload[0]){

		case 5:

            console.log(value.length);
            console.log(struct.sizeOf(parsedPayload[4] + 'B'));

            var blinkData = struct.unpack(
			    parsedPayload[4] + 'B',
                value.slice(36));
            dataLog('g',['b', ...parsedPayload, 'PAYLOAD', ...blinkData]);

			break;

		case 6:
            console.log('--6--');
            console.log(value.length);
            console.log(struct.sizeOf('HHIHHIHHIHHIHHIHHIHHIHHIHHIHHIII'.repeat(4)));

			var thermalData = struct.unpack(
                'HHIHHIHHIHHIHHIHHIHHIHHIHHIHHIII'.repeat(4),
                value.slice(36));
            dataLog('g',['t', ...parsedPayload, 'PAYLOAD', ...thermalData]);

			break;

		case 7:

            var accData = struct.unpack(
			    'hhhII'.repeat(25),
                value.slice(36));
            dataLog('g',['a', ...parsedPayload, 'PAYLOAD', ...accData]);

			break;

		case 9:

            var gyroData = struct.unpack(
			    'hhhII'.repeat(25),
                value.slice(36));
            dataLog('g',['g', ...parsedPayload, 'PAYLOAD', ...gyroData]);

			break;

		default:

			console.error('UNKOWN PACKET TYPE');
	}
	}catch(e){
	   console.error('Failed to read BLE packet from Glasses, likely unpack failure');
        console.error(e);
	}
}

function base64ToHex(str) {
    console.log(str);
    const raw = base64.decode(str);
    console.log(raw);
    let result = '';
    for (let i = 0; i < raw.length; i++) {
        const hex = raw.charCodeAt(i).toString(16);
        result += (hex.length === 2 ? hex : '0' + hex);
    }
    return result.toUpperCase();
}

function hexToBase64(str) {
    return base64.encode(str.match(/\w{2}/g).map(function(a) {
        return String.fromCharCode(parseInt(a, 16));
    }).join(""));
}

function decimalToHex(d, padding=2) {
    var hex = Number(d).toString(16);
    padding = typeof (padding) === "undefined" || padding === null ? padding = 2 : padding;

    while (hex.length < padding) {
        hex = "0" + hex;
    }

    return hex;
}

function bytesToHex(bytes) {
    for (var hex = [], i = 0; i < bytes.length; i++) {
    var current = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hex.push((current >>> 4).toString(16));
    hex.push((current & 0xf).toString(16));
    }
    return hex.join("");
}

function startScan(){
    BLESTATE['scanner'] = BLESTATE['manager'].startScan();
    console.log('start scanning...');
    BLESTATE['scanner'].on('report', handleScanReport);
}

function stopScan(){
    BLESTATE['scanner'].stopScan();
    console.log('stopping scan.');
}

function sendToGlasses(command){
    //BLESTATE['gWrite'].write(Buffer.from([65, 66, 67])); // Can add callback if we want the result status
}

function checkConnections(){
    if (BLESTATE['gConn'] != null && BLESTATE['wConn'] != null){
        console.log('Connected to Both Watch and Glasses');
        blinkForNSeconds(5);
        stopScan();
    }
}

function handleScanReport(eventData){

        if (eventData.connectable && eventData.parsedDataItems['localName'] == 'CAPTIVATE' && BLESTATE['gConn'] == null) {

            console.log('>>> Found Glasses');
            stopScan();

            BLESTATE['manager'].connect(eventData.addressType, eventData.address, {/*options*/}, function(conn) {

                console.log(conn.gatt);
                BLESTATE['gConn'] = conn;
                console.log('Connected to ' + conn.peerAddress);

                console.log('exchange MTU');
                conn.gatt.exchangeMtu(function(err) { console.log('MTU THING:' + err); console.log('MTU: ' + conn.gatt.currentMtu); });

                console.log('discover_services');
                //conn.gatt.discoverServicesByUuid(CAPTIVATES_SERVICE_UUID, 1, function(services) {
                conn.gatt.discoverAllPrimaryServices(function(services) {
                    if (services.length == 0) {
                        return;
                    }
                    for (let service in services){
                        console.log('SERVICE:' + services[service].uuid);
                        services[service].discoverCharacteristics(function(characteristics) {
                            for (var i = 0; i < characteristics.length; i++) {
                                var c = characteristics[i];
                                if (c.uuid.toLowerCase() == CAPTIVATES_LED_UUID) {
                                    console.log('GOT WRITE CHARACTERISTIC');
                                    console.log(c);
                                    //c.write(Buffer.from([255, 0, 170]));
                                    BLESTATE['gWrite'] = c;
                                }
                                if ( c.uuid.toLowerCase() == CAPTIVATES_RX_UUID) {

                                    console.log('GOT NOTIFY CHARACTERISTIC');
                                    console.log(c);
//                                    c.writeCCCD(/*enableNotifications*/ true, /*enableIndications*/ false);
//                                    c.on('change', updateGlassesData);
                                }
                            }
                        });
                    }
                    checkConnections();
                    console.log('checking MTU again:' + conn.gatt.currentMtu);
                    conn.gatt.cancelReliableWrite();
                    setTimeout(changeColor, 30000);
                });

                BLESTATE['gConn'].on('disconnect', function(reason) {
                    console.log('Disconnected from glasses ' + conn.peerAddress + ' due to ' + HciErrors.toString(reason));
                    LED.writeSync(1); //set pin state to 1 (turn LED on)
                    BLESTATE['gConn'] = null;
                    startScan();

                });
            });
    } else{
        //console.log('Found device named ' + (eventData.parsedDataItems['localName'] || '(no name)'));// + ':', eventData);
    }
}

var BLESTATE = {
    'manager': null,
    'scanner': null,
    'gConn': null,
    'wConn': null,
    'gWrite': null,
    'wWrite': null
}

BleManager.create(transport, options, function(err, manager){
    if (err) {
        console.error(err);
        return;
    }

    BLESTATE['manager'] = manager;
    startScan({scanWindow:20, scanInterval:20, scanFilters: [new BleManager.BdAddrScanFilter('public', CAPTIVATES_ADDRESS)]});
});


