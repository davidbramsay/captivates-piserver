var net = require('net');

//E4 Streaming Server
var HOST = '192.168.2.29';
var PORT = 28000;
//Device
var ID = 'F035CD';

var client= new net.Socket();


var command_list = [
    'device_list\r\n',
    'device_connect ' + ID + '\r\n',
    'device_subscribe tag ON\r\n',
    'device_subscribe bat ON\r\n',
    'device_subscribe tmp ON\r\n',
    'device_subscribe gsr ON\r\n',
    'device_subscribe ibi ON\r\n',
    'device_subscribe acc ON\r\n',
    'device_subscribe bvp ON\r\n'
];

var request_num = 0;

client.connect(PORT, HOST, function() {
    console.log('Client connected to: ' + HOST + ':' + PORT);
    client.write(command_list[0]);

});

client.on('data', function(data) {

    // convert raw buffer to string, remove returns, separate on newlines
    let raw_string = data.toString().replace(/\r/g, '').split('\n');

    //for each split out packet, grab the data
    for (var i =0; i < raw_string.length-1; i++){

        let vals = raw_string[i].split(' ');
        let packet = {'type': vals[0], 'timestamp': vals[1], 'data': vals.splice(2)};

        switch(packet['type']){

        case 'R':
            console.log('GOT RESPONSE: ' + packet['data']);

            if (++request_num<command_list.length){
                console.log('Sending ' + command_list[request_num]);
                client.write(command_list[request_num]);
            }
        break;

        case 'E4_Acc':
        case 'E4_Temperature':
        case 'E4_Bvp':
        case 'E4_Hr':
        case 'E4_Ibi':
        case 'E4_Gsr':
        case 'E4_Battery':
        case 'E4_Tag':
            //console.log(packet);
        break;

        default:
        console.log('unknown type: ' + vals);


        }
    }

    if (data.toString().endsWith('exit')) {
      client.destroy();
    }
});

// Add a 'close' event handler for the client socket
client.on('close', function() {
    console.log('Client closed');
});

client.on('error', function(err) {
    console.error(err);
});
