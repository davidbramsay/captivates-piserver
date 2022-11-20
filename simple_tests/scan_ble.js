const NodeBleHost = require('ble-host');
const BleManager = NodeBleHost.BleManager;
const AdvertisingDataBuilder = NodeBleHost.AdvertisingDataBuilder;
const HciErrors = NodeBleHost.HciErrors;
const AttErrors = NodeBleHost.AttErrors;
const HciSocket = require('hci-socket');

var transport = new HciSocket(); // connects to the first hci device on the computer, for example hci0

var options = {
    // optional properties go here
};

BleManager.create(transport, options, function(err, manager) {
    // err is either null or an Error object
    // if err is null, manager contains a fully initialized BleManager object
    if (err) {
        console.error(err);
        return;
    }
    
    var scanner = manager.startScan();
    scanner.on('report', function(eventData) {
        if (eventData.connectable) {
	    console.log('-------------------');	
            console.log('Found device named ' + (eventData.parsedDataItems['localName'] || '(no name)') + ':', eventData);
	        console.log(eventData.addressType + ' | ' + eventData.address);	
        }
    });
});
