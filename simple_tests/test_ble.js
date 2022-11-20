const NodeBleHost = require('ble-host');
const BleManager = NodeBleHost.BleManager;
const AdvertisingDataBuilder = NodeBleHost.AdvertisingDataBuilder;
const HciErrors = NodeBleHost.HciErrors;
const AttErrors = NodeBleHost.AttErrors;
const HciSocket = require('hci-socket');

const struct = require('python-struct');
const base64 = require('base-64');

const CAPTIVATES_SERVICE_UUID = "0000fe80-8e22-4541-9d4c-21edae82ed19";
const CAPTIVATES_LED_UUID = "0000fe84-8e22-4541-9d4c-21edae82ed19";
const CAPTIVATES_RX_UUID = "0000fe81-8e22-4541-9d4c-21edae82ed19";
const CAPTIVATES_ADDRESS = '80:E1:26:24:87:8D'

var transport = new HciSocket(); // connects to the first hci device on the computer, for example hci0

var options = {
    // optional properties go here
};

async function dataLog(type, dataArray){
	let currentTimestamp = new Date().toISOString();
	console.log('dataLOG:' + type + ',' + currentTimestamp + ',' + dataArray);
 	//return await writeLineToDisk([type, currentTimestamp, ...dataArray]);
}

function updateGlassesData(value) {
	try{
    //var hexraw = base64ToHex(value);
  	var parsedPayload = struct.unpack(
                    'HHIIIIIIII',
                    value.slice(0,36));

	//console.log(parsedPayload); //i.e. [5, 92, 38148, 0, 200, NaN, NaN, NaN, NaN, NaN]
	//packetType, packetNum, msFromStart, epoch, PacketSize

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



BleManager.create(transport, options, function(err, manager) {
    // err is either null or an Error object
    // if err is null, manager contains a fully initialized BleManager object
    if (err) {
        console.error(err);
        return;
    }

    var scanner = manager.startScan();
    scanner.on('report', function(eventData) {
        if (eventData.connectable && eventData.parsedDataItems['localName'] == 'CAPTIVATE') {
            console.log('Found device named ' + (eventData.parsedDataItems['localName'] || '(no name)') + ':', eventData);
            scanner.stopScan();
            manager.connect(eventData.addressType, eventData.address, {/*options*/}, function(conn) {
                console.log('Connected to ' + conn.peerAddress);

		console.log('exchange MTU');
                conn.gatt.exchangeMtu(function(err) { console.log('MTU THING:' + err); console.log('MTU: ' + conn.gatt.currentMtu); });

		console.log('discover_services');
                //conn.gatt.discoverAllPrimaryServices(function(services) {
		conn.gatt.discoverServicesByUuid(CAPTIVATES_SERVICE_UUID, 1, function(services) {
		    console.log(services);
                    if (services.length == 0) {
                        return;
                    }
                    var service = services[0];
                    service.discoverCharacteristics(function(characteristics) {
                        for (var i = 0; i < characteristics.length; i++) {
                            var c = characteristics[i];
                            console.log('Found ' + c.uuid);
                            if (c.properties['notify']) {
                                c.writeCCCD(/*enableNotifications*/ true, /*enableIndications*/ false);
                                c.on('change', updateGlassesData);
                            }
                        }
                    });
                });
                conn.on('disconnect', function(reason) {
                    console.log('Disconnected from ' + conn.peerAddress + ' due to ' + HciErrors.toString(reason));
                });
            });
        }
    });
});
