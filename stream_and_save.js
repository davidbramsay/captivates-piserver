const NodeBleHost = require('ble-host');
const BleManager = NodeBleHost.BleManager;
const AdvertisingDataBuilder = NodeBleHost.AdvertisingDataBuilder;
const HciErrors = NodeBleHost.HciErrors;
const AttErrors = NodeBleHost.AttErrors;
const HciSocket = require('hci-socket');
const struct = require('python-struct');
const fs = require('fs');

//Open File for writing will close either when we hit:
var MAXRECORDS = 12500;  //max records before closing a file
var FILETIMEOUT = 240; //open file for writing timeout in mins

//Indicator LED on pi control
var LEDINDICATEWATCH = true; //if true, pi LED on either watch/glasses disconnected
                              //if false, pi LED on when glasses disconnected

//Control behavior for LED on glasses
var gLEDTRANSITION = true; //if true, do a glasses LED Transtion LEDMINTILTRANSITION min after checking the time. otherwise no LED interaction.
var gLEDMIN = 2; //min to wait before LED transition after last time check or last noticed transition.
var gLEDMINVARIANCE = 2; //uniform distribution of width LEDMINVARIANCE minutes around LEDMIN to make transitions not perfectly predictable.

var BLESTATE = {
    'manager': null,
    'scanner': null,
    'gConn': null,
    'wConn': null,
    'gWrite': null,
    'wWrite': null
}

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
const CAPTIVATES_ADDRESS = '80:E1:26:24:87:8D';

const EQUINOX_SERVICE_UUID = "0000fe40-cc7a-482a-984a-7f2ed5b3e58f";
const EQUINOX_TX_UUID = "0000fe41-8e22-4541-9d4c-21edae82ed19";
const EQUINOX_RX_UUID = "0000fe42-8e22-4541-9d4c-21edae82ed19";

const { processWatchPacket,
         constructWatchTXTimestamp,
         constructWatchTXTimeBounds,
         constructWatchTXPause
         } = require('./watchHelpers.js');

var transport = new HciSocket(); // connects to the first hci device on the computer, for example hci0

var options = {
    // optional properties go here
};

//turn LED ON after brief off (to make sure we're still controlling it)
var Gpio = require('onoff').Gpio; //include onoff to interact with the GPIO
var LED = new Gpio(4, 'out'); //use GPIO pin 4, and specify that it is output
var blinkInterval = null;
LED.writeSync(0);
setTimeout(()=>{LED.writeSync(1);}, 250);

function blinkLED() {
  if (LED.readSync() === 0) { //check the pin state, if the state is 0 (or off)
    LED.writeSync(1); //set pin state to 1 (turn LED on)
  } else {
    LED.writeSync(0); //set pin state to 0 (turn LED off)
  }
}

function startBlink() {
  if (blinkInterval == null){
    blinkInterval = setInterval(blinkLED, 250); //run the blinkLED function every 250ms
  }
}

function endBlink() { //function to stop blinking
  clearInterval(blinkInterval); // Stop blink intervals
  blinkInterval = null;
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

      if (BLESTATE['gConn'] == null){
        console.log('cannot change color, glasses not connected');
      } else {
          if (!transitioning && 70 == lightState[4]){
          dataLog('u', ['VIDGAME', 'START_TRANSITION']);
          transitioning = true;
          }
          if (transitioning){
            moveToBlue();
            lightTimer = setTimeout(changeColor.bind(this), 500);
          }
      }
}


var fileStreaming = false;
var writeStream = null;
var numRecords = 0;
var fileCloseTimer = null;

function closeOpenFile(){
    if (fileStreaming){
        writeStream.end();
        writeStream = null;
        fileStreaming = false;
    } else {
        console.error('Tried to close a file when no files are open.');
    }
}

function writeLineToDisk(dataArray){

    if (numRecords >= MAXRECORDS){//if we've maxed out our file
        console.log('Closing file due to maxrecords.');
        closeOpenFile();
        clearTimeout(fileCloseTimer);
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

        fileCloseTimer = setTimeout(()=>{
            console.log('Closing file due to timeout.');
            closeOpenFile();
        }, FILETIMEOUT*60*1000);
    }

    writeStream.write(dataArray.join(',') + '\n');
    numRecords += 1;
}

var tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds

function dataLog(type, dataArray){
    let currentTimestamp = (new Date(Date.now() - tzoffset)).toISOString().slice(0, -1);

    /*if (type=='g'){
        console.log(currentTimestamp + ': got packet (' + type + ':' + dataArray[0] + ')');
    } else {
        console.log(currentTimestamp + ': got packet (' + type + ':' + dataArray[1] + ')');
    }*/
 	return writeLineToDisk([type, currentTimestamp, ...dataArray]);
}

function sendLEDUpdate(ledArray){
    if(BLESTATE['gWrite'] != null){

      console.log('Writing glasses LED: ' + ledArray);
      BLESTATE['gWrite'].writeWithoutResponse(Buffer.from(ledArray.slice(0)));

    }else{
        console.error('glasses write not connected');
    }
}

function watchSendUpdateRTC(){
    if(BLESTATE['wWrite'] != null){
        console.log('sending watch update RTC');
        BLESTATE['wWrite'].writeWithoutResponse(Buffer.from(constructWatchTXTimestamp(), 'hex'));
    }else{
        console.error('watch write not connected');
    }
}

function watchSendPause(pause=true){
    if(BLESTATE['wWrite'] != null){
        console.log('sending pause ' + pause + '.');
        BLESTATE['wWrite'].writeWithoutResponse(Buffer.from(constructWatchTXPause(pause), 'hex'));
    }else{
        console.error('watch write not connected');
    }
}


function updateWatchData(value){
    let dataArray = processWatchPacket(value);
	dataLog('w', dataArray);

    if (gLEDTRANSITION && dataArray[1] == 'TX_TIME_SEEN' && BLESTATE['gConn'] != null){
        clearTimeout(lightTimer);

        if (transitioning){
            transitioning = false;
        }

        resetLight();

        let mins =  gLEDMIN + (Math.random()*gLEDMINVARIANCE) - (gLEDMINVARIANCE/2);
        console.log('transition armed for ' + mins + ' mins.');
        lightTimer = setTimeout(changeColor, Math.round(mins*60*1000));
    }
}


function updateGlassesData(value) {
	try{

  	var parsedPayload = struct.unpack(
                    'HHIIIIIIII',
                    value.slice(0,36));

	switch(parsedPayload[0]){

		case 5:
            var blinkData = struct.unpack(
			    parsedPayload[4] + 'B',
                value.slice(36));
            dataLog('g',['b', ...parsedPayload, 'PAYLOAD', ...blinkData]);
			break;

		case 6:
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

var scanning = false;

function startScan(){
    if (!scanning){
        scanning = true;
        console.log('start scanning...');
        BLESTATE['scanner'] = BLESTATE['manager'].startScan();
        BLESTATE['scanner'].on('report', handleScanReport);
    }
}

function stopScan(){
    if (scanning){
        BLESTATE['scanner'].stopScan();
        scanning = false;
        console.log('stopping scan.');
    }
}

function checkConnections(){
    if ((LEDINDICATEWATCH && BLESTATE['gConn'] != null && BLESTATE['wConn'] != null) ||
       (!LEDINDICATEWATCH && BLESTATE['gConn'] != null)){

        console.log('LED indicator off.');
        blinkForNSeconds(5);
    }

    if (BLESTATE['gConn'] != null && BLESTATE['wConn'] != null){
        console.log('Connected to both Glasses and Watch.');
        stopScan();
    }
}

function handleScanReport(eventData){

        if (eventData.connectable && eventData.parsedDataItems['localName'] == 'CAPTIVATE' && BLESTATE['gConn'] == null) {

            console.log('>>> Found Glasses');

            BLESTATE['manager'].connect(eventData.addressType, eventData.address, {/*options*/}, function(conn) {

                console.log(conn.gatt);
                BLESTATE['gConn'] = conn;
                console.log('Connected to ' + conn.peerAddress);

                console.log('GLASSES: exchange MTU');
                conn.gatt.exchangeMtu(function(err) {console.log('GLASSES: MTU Negotiated: ' + conn.gatt.currentMtu); });

                console.log('GLASSES: discover_services');
                conn.gatt.discoverAllPrimaryServices(function(services) {
                    if (services.length == 0) {
                        return;
                    }
                    for (let service in services){
                        console.log('GLASSES: SERVICE:' + services[service].uuid);
                        services[service].discoverCharacteristics(function(characteristics) {
                            for (var i = 0; i < characteristics.length; i++) {
                                var c = characteristics[i];
                                if (c.uuid.toLowerCase() == CAPTIVATES_LED_UUID) {
                                    console.log('GLASSES: GOT GLASSES WRITE CHARACTERISTIC');
                                    //console.log(c);
                                    BLESTATE['gWrite'] = c;
                                }
                                if ( c.uuid.toLowerCase() == CAPTIVATES_RX_UUID) {
                                    console.log('GLASSES: GOT GLASSES NOTIFY CHARACTERISTIC');
                                    //console.log(c);
                                    c.writeCCCD(/*enableNotifications*/ true, /*enableIndications*/ false);
                                    c.on('change', updateGlassesData);
                                }
                            }
                        });
                    }

                    checkConnections();
                });

                BLESTATE['gConn'].on('disconnect', function(reason) {
                    console.log('GLASSES: Disconnected from glasses ' + conn.peerAddress + ' due to ' + HciErrors.toString(reason));
                    LED.writeSync(1); //set pin state to 1 (turn LED on)
                    BLESTATE['gConn'] = null;
                    BLESTATE['gWrite'] = null;
                    console.log('Closing File due to Glasses Disconnect.');
                    closeOpenFile();
                    clearTimeout(fileCloseTimer);
                    startScan();
                });
            });
    } else if (eventData.connectable && eventData.parsedDataItems['localName'] == 'WATCH01' && BLESTATE['wConn'] == null) {

            console.log('>>> Found Watch');

            BLESTATE['manager'].connect(eventData.addressType, eventData.address, {/*options*/}, function(conn) {

                console.log(conn.gatt);
                BLESTATE['wConn'] = conn;
                console.log('WATCH: Connected to ' + conn.peerAddress);

                console.log('WATCH: exchange MTU');
                conn.gatt.exchangeMtu(function(err) {console.log('WATCH: MTU Negotiated: ' + conn.gatt.currentMtu); });

                console.log('WATCH: discover_services');
                conn.gatt.discoverAllPrimaryServices(function(services) {
                    if (services.length == 0) {
                        return;
                    }
                    for (let service in services){
                        console.log('WATCH: SERVICE:' + services[service].uuid);
                        services[service].discoverCharacteristics(function(characteristics) {
                            for (var i = 0; i < characteristics.length; i++) {
                                var c = characteristics[i];
                                if (c.uuid.toLowerCase() == EQUINOX_TX_UUID) {
                                    console.log('WATCH: GOT WATCH WRITE CHARACTERISTIC');
                                    //console.log(c);
                                    BLESTATE['wWrite'] = c;
                                    watchSendUpdateRTC();
                                    //watchSendPause();
                                    //setTimeout(()=>{watchSendPause(false);}, 2000);
                                }
                                if ( c.uuid.toLowerCase() == EQUINOX_RX_UUID) {

                                    console.log('WATCH: GOT WATCH NOTIFY CHARACTERISTIC');
                                    //console.log(c);
                                    c.writeCCCD(/*enableNotifications*/ true, /*enableIndications*/ false);
                                    c.on('change', updateWatchData);
                                }
                            }
                        });
                    }

                    checkConnections();
                });

                BLESTATE['wConn'].on('disconnect', function(reason) {
                    console.log('WATCH: Disconnected from watch ' + conn.peerAddress + ' due to ' + HciErrors.toString(reason));
                    if (LEDINDICATEWATCH){
                        LED.writeSync(1); //set pin state to 1 (turn LED on)
                    }
                    BLESTATE['wConn'] = null;
                    BLESTATE['wWrite'] = null;
                    startScan();
                });
            });
    } else{
        //console.log('Found device named ' + (eventData.parsedDataItems['localName'] || '(no name)'));// + ':', eventData);
    }
}

BleManager.create(transport, options, function(err, manager){
    if (err) {
        console.error(err);
        return;
    }

    BLESTATE['manager'] = manager;
    startScan();
});


