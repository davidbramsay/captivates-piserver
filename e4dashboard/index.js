const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const net = require('net');

//E4 Streaming Server
const E4_HOST = '192.168.2.29';
const E4_PORT = 28000;

//Device
const E4_ID = 'F035CD';

//Front-end
const WEB_PORT = 8000;

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

// Webserver Start

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.use(express.static('public'));

io.on('connection', (socket) => {
  socket.on('chat message', msg => {
    io.emit('chat message', msg);
  });
});

http.listen(WEB_PORT, () => {
  console.log(`Webserver running at http://localhost:${WEB_PORT}/`);
});


// E4 Start

client.on('data', function(data) {

    let raw_string = data.toString().replace(/\r/g, '').split('\n');

    //for each split out packet, grab the data
    for (var i =0; i < raw_string.length-1; i++){

        let vals = raw_string[i].split(' ');
        let packet = {'type': vals[0], 'timestamp': vals[1], 'data': vals.splice(2)};

        switch(packet['type']){

        case 'R':
            console.log('GOT RESPONSE: ' + packet['data']);
            io.emit(packet['type'], [packet['timestamp'], packet['data']]);

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
            io.emit(packet['type'], [packet['timestamp'], packet['data']]);
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


client.connect(E4_PORT, E4_HOST, function() {
    console.log('E4 client connected to: ' + E4_HOST + ':' + E4_PORT);
    client.write(command_list[0]);

});

