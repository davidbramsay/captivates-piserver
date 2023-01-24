const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const net = require('net');
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

//Control behavior for LED on glasses
var gLEDTRANSITION = true; //if true, do a glasses LED Transtion LEDMINTILTRANSITION min after checking the time. otherwise no LED interaction.
var gLEDMIN = 2; //min to wait before LED transition after last time check or last noticed transition.
var gLEDMINVARIANCE = 2; //uniform distribution of width LEDMINVARIANCE minutes around LEDMIN to make transitions not perfectly predictable.

//E4 Streaming Server
const E4_HOST = '192.168.3.207';
const E4_PORT = 28000;

var SAVE_DATA = false;

//Device
const E4_ID = 'F035CD';

//Front-end
const WEB_PORT = 8000;


// Webserver Start
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.use(express.static('public'));

http.listen(WEB_PORT, () => {
  console.log(`Webserver running at http://localhost:${WEB_PORT}/`);
});

//Bluetooth for Glasses/Watch Connection
var BLESTATE = {
    'manager': null,
    'scanner': null,
    'gConn': null,
    'wConn': null,
    'gWrite': null,
    'wWrite': null
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
          io.emit('LED', ['START_TRANSITION']);
          }
          if (transitioning){
            moveToBlue();
            lightTimer = setTimeout(changeColor.bind(this), 500);
          }
      }
}



//File IO
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
 	return writeLineToDisk([type, currentTimestamp, ...dataArray]);
}




//E4 Connection
const client= new net.Socket();

const command_list = [
    'device_list\r\n',
    'device_connect ' + E4_ID + '\r\n',
    'device_subscribe tag ON\r\n',
    'device_subscribe bat ON\r\n',
    'device_subscribe tmp ON\r\n',
    'device_subscribe gsr ON\r\n',
    'device_subscribe ibi ON\r\n',
    'device_subscribe acc ON\r\n',
    'device_subscribe bvp ON\r\n'
];

var request_num = 0;


// E4 Start
function connectToE4(){
    console.log('attempting connection...');
    client.connect({port:E4_PORT, host:E4_HOST});
    client.setTimeout(10000, function(){
        console.log('[E4 SERVER] CONNECTION TIMEOUT!');
        client.destroy();
    });
}

connectToE4();

client.on('connect', function() {
        console.log('[E4 SERVER] Client connected to: ' + E4_HOST + ':' + E4_PORT);
        client.setTimeout(0);
        request_num = 0;
        client.write(command_list[request_num]);
});

client.on('data', function(data) {

    let raw_string = data.toString().replace(/\r/g, '').split('\n');

    //for each split out packet, grab the data
    for (var i =0; i < raw_string.length-1; i++){

        let vals = raw_string[i].split(' ');
        let packet = {'type': vals[0], 'timestamp': vals[1], 'data': vals.splice(2)};

        switch(packet['type']){

        case 'R':
            console.log('[E4 SERVER] Cmd response: ' + packet['data'].join(' '));

            if (packet['data'].includes('ERR')) {
                if (request_num == 1){
                    //device connect failed. wait 10 sec and call it again.
                    console.log('[E4 SERVER] Detected Error Connecting device.');
                    setTimeout(() => {
                        console.log('[E4 SERVER] Sending ' + command_list[request_num]);
                        client.write(command_list[request_num]);
                    }, 10000);
                } else {
                    console.log('[E4 SERVER] Issue with connection! Destroy!');
                    client.destroy();
                }
            } else if (packet['data'].includes('lost')){
                    console.log('[E4 SERVER] Detected Lost Connection');
                    client.destroy();
            } else if (++request_num<command_list.length){
                console.log('[E4 SERVER] Sending ' + command_list[request_num]);
                client.write(command_list[request_num]);
            } else {
                console.log('[E4 SERVER] Finished Initial Handshake');
            }

            break;

        case 'E4_Acc':
        case 'E4_Bvp':
        case 'E4_Hr':
        case 'E4_Gsr':
        case 'E4_Battery':
        case 'E4_Temperature':
            io.emit(packet['type'], [packet['timestamp'], packet['data']]);
        case 'E4_Ibi':
        case 'E4_Tag':
            if (SAVE_DATA){
                dataLog('e',[packet['timestamp']*1000, packet['type'], ...packet['data']]);
            }
            break;

        default:
            console.log('[E4 SERVER] unknown packet-type: ' + vals);
        }
    }

});

client.on('close', function() {
    console.log('[E4 SERVER] Client closed');
    connectToE4();
});

client.on('error', function(err) {
    console.log('[E4 SERVER] Client error');
    console.error(err);
});

function sendLEDUpdate(ledArray){
    if(BLESTATE['gWrite'] != null){

      console.log('[GLASSES] Writing glasses LED: ' + ledArray);
      BLESTATE['gWrite'].writeWithoutResponse(Buffer.from(ledArray.slice(0)));
      io.emit('LED', ['COLOR', 0, ledArray[5], ledArray[4]]);
    }else{
        console.error('[GLASSES] glasses write not connected');
    }
}

function watchSendUpdateRTC(){
    if(BLESTATE['wWrite'] != null){
        console.log('[WATCH] sending watch update RTC');
        BLESTATE['wWrite'].writeWithoutResponse(Buffer.from(constructWatchTXTimestamp(), 'hex'));
    }else{
        console.error('[WATCH] watch write not connected');
    }
}

function watchSendPause(pause=true){
    if(BLESTATE['wWrite'] != null){
        console.log('[WATCH] sending pause ' + pause + '.');
        BLESTATE['wWrite'].writeWithoutResponse(Buffer.from(constructWatchTXPause(pause), 'hex'));
    }else{
        console.error('[WATCH] watch write not connected');
    }
}


function updateWatchData(value){
    let dataArray = processWatchPacket(value);
    if (SAVE_DATA){
        dataLog('w', dataArray);
    }
    io.emit('w', dataArray);

    if (gLEDTRANSITION && dataArray[1] == 'TX_TIME_SEEN' && BLESTATE['gConn'] != null){
        clearTimeout(lightTimer);

        io.emit('LED', ['NOTICED']);
        if (transitioning){
            transitioning = false;
        }

        resetLight();

        let mins =  gLEDMIN + (Math.random()*gLEDMINVARIANCE) - (gLEDMINVARIANCE/2);
        console.log('[TIMER] transition armed for ' + mins + ' mins.');
        lightTimer = setTimeout(changeColor, Math.round(mins*60*1000));
        io.emit('LED', ['ARMED', mins*60*1000]);
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
            if (SAVE_DATA){
                dataLog('g',['b', ...parsedPayload, 'PAYLOAD', ...blinkData]);
            }
            io.emit('gb', [parsedPayload[2], ...blinkData]);
			break;

		case 6:
			var thermalData = struct.unpack(
                'HHIHHIHHIHHIHHIHHIHHIHHIHHIHHIII'.repeat(4),
                value.slice(36));
            if (SAVE_DATA){
                dataLog('g',['t', ...parsedPayload, 'PAYLOAD', ...thermalData]);
            }
            io.emit('gt', thermalData);
			break;

		case 7:
            var accData = struct.unpack(
			    'hhhII'.repeat(25),
                value.slice(36));

            if (SAVE_DATA){
                dataLog('g',['a', ...parsedPayload, 'PAYLOAD', ...accData]);
            }
            io.emit('ga', accData);
			break;

		case 9:
            if (SAVE_DATA){
                var gyroData = struct.unpack(
                    'hhhII'.repeat(25),
                    value.slice(36));

                dataLog('g',['g', ...parsedPayload, 'PAYLOAD', ...gyroData]);
            }
            //io.emit('gg', gyroData);
			break;

		default:
			console.error('UNKOWN PACKET TYPE');
	}
	}catch(e){
	   console.error('[GLASSES] Failed to read BLE packet from Glasses, likely unpack failure');
        console.error(e);
	}
}

var scanning = false;

function startScan(){
    if (!scanning){
        scanning = true;
        console.log('[BLE] start scanning...');
        BLESTATE['scanner'] = BLESTATE['manager'].startScan();
        BLESTATE['scanner'].on('report', handleScanReport);
    }
}

function stopScan(){
    if (scanning){
        BLESTATE['scanner'].stopScan();
        scanning = false;
        console.log('[BLE] stopping scan.');
    }
}

function checkConnections(){

    if (BLESTATE['gConn'] != null && BLESTATE['wConn'] != null){
        console.log('[BLE] Connected to both Glasses and Watch.');
        stopScan();
    }
}

function handleScanReport(eventData){

        if (eventData.connectable && eventData.parsedDataItems['localName'] == 'CAPTIVATE' && BLESTATE['gConn'] == null) {

            console.log('[BLE] Found Glasses');

            BLESTATE['manager'].connect(eventData.addressType, eventData.address, {/*options*/}, function(conn) {

                console.log(conn.gatt);
                BLESTATE['gConn'] = conn;
                console.log('[BLE] Connected to ' + conn.peerAddress);

                console.log('[BLE] GLASSES: exchange MTU');
                conn.gatt.exchangeMtu(function(err) {console.log('[BLE] GLASSES: MTU Negotiated: ' + conn.gatt.currentMtu); });

                console.log('[BLE] GLASSES: discover_services');
                conn.gatt.discoverAllPrimaryServices(function(services) {
                    if (services.length == 0) {
                        return;
                    }
                    for (let service in services){
                        //console.log('[BLE] GLASSES: SERVICE:' + services[service].uuid);
                        services[service].discoverCharacteristics(function(characteristics) {
                            for (var i = 0; i < characteristics.length; i++) {
                                var c = characteristics[i];
                                if (c.uuid.toLowerCase() == CAPTIVATES_LED_UUID) {
                                    console.log('[GLASSES] GOT GLASSES WRITE CHARACTERISTIC');
                                    //console.log(c);
                                    BLESTATE['gWrite'] = c;
                                }
                                if ( c.uuid.toLowerCase() == CAPTIVATES_RX_UUID) {
                                    console.log('[GLASSES] GOT GLASSES NOTIFY CHARACTERISTIC');
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
                    console.log('[GLASSES] Disconnected from glasses ' + conn.peerAddress + ' due to ' + HciErrors.toString(reason));
                    BLESTATE['gConn'] = null;
                    BLESTATE['gWrite'] = null;
                    console.log('[GLASSES] Closing File due to Glasses Disconnect.');
                    closeOpenFile();
                    clearTimeout(fileCloseTimer);
                    startScan();
                });
            });
    } else if (eventData.connectable && eventData.parsedDataItems['localName'] == 'WATCH01' && BLESTATE['wConn'] == null) {

            console.log('[BLE] Found Watch');

            BLESTATE['manager'].connect(eventData.addressType, eventData.address, {/*options*/}, function(conn) {

                console.log(conn.gatt);
                BLESTATE['wConn'] = conn;
                console.log('[BLE] WATCH: Connected to ' + conn.peerAddress);

                console.log('[BLE] WATCH: exchange MTU');
                conn.gatt.exchangeMtu(function(err) {console.log('[BLE] WATCH: MTU Negotiated: ' + conn.gatt.currentMtu); });

                console.log('[BLE] WATCH: discover_services');
                conn.gatt.discoverAllPrimaryServices(function(services) {
                    if (services.length == 0) {
                        return;
                    }
                    for (let service in services){
                        console.log('[BLE] WATCH: SERVICE:' + services[service].uuid);
                        services[service].discoverCharacteristics(function(characteristics) {
                            for (var i = 0; i < characteristics.length; i++) {
                                var c = characteristics[i];
                                if (c.uuid.toLowerCase() == EQUINOX_TX_UUID) {
                                    console.log('[WATCH] GOT WATCH WRITE CHARACTERISTIC');
                                    //console.log(c);
                                    BLESTATE['wWrite'] = c;
                                    watchSendUpdateRTC();
                                    //watchSendPause();
                                    //setTimeout(()=>{watchSendPause(false);}, 2000);
                                }
                                if ( c.uuid.toLowerCase() == EQUINOX_RX_UUID) {

                                    console.log('[WATCH] GOT WATCH NOTIFY CHARACTERISTIC');
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
                    console.log('[WATCH] Disconnected from watch ' + conn.peerAddress + ' due to ' + HciErrors.toString(reason));
                    BLESTATE['wConn'] = null;
                    BLESTATE['wWrite'] = null;
                    startScan();
                });
            });
    } else{
        //console.log('Found device named ' + (eventData.parsedDataItems['localName'] || '(no name)'));// + ':', eventData);
    }
}

BleManager.create(transport, {}, function(err, manager){
    if (err) {
        console.error(err);
        return;
    }

    BLESTATE['manager'] = manager;
    startScan();
});


