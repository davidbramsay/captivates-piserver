## Glasses and Watch BLE on Raspberry Pi 4B

This project is to automatically stream data from the captivates glasses and
equinox smartwatch to this device when they are in range. 

### Important Notes

<ol>
<li> The led turns on when either the watch or glasses are
disconnected, and blinks when they both successfully connect before turning
off.  This behavior can be changed to just indicate for glasses connection with
the LEDINDICATE global</li>
<li> The peripheral LED on the glasses resets on the first watch time guess,
and uses a subsequent time guess to indicate the LED has been seen to restart
the process.  This code might need to change for the experiment; also, the
delay and variability (how long it takes after a time guess for the LED to
transition) is set in gLEDMIN and gLEDMINVARIANCE globals. </li>
<li> There *may* be a memory leak with the read connection/callback (we don't
assign it to a variable and null it on disconnect).  After profiling it doesn't
seem to be a big deal (it would be a slow leak just on disconnect/reconnect),
but it may be worth assigning the notify connection to a variable, striking the
subscription, and nulling the reference. </li>
<li> The log current logs every time a packet is received, which is monstorous.
We need to turn this off; perhaps we can log packet statistics every n
seconds. </li>
<li> file writes max out at 12500 records, which is a pretty big file (~10MB).
When we don't hit 12500 records in 4 hours we still write a file (i.e. if just
watch data is streaming); we also write a file when the glasses
disconnect.  These settings can be modified with some of the globals.</li>
<li> It would be nice to add a socketio websocket server here to stream data
live, and to work with the E4 streaming server as well.  Major TODO item.
</li>
</ol>

### Setup

Raspberry Pi 4B has bluetooth 5.0 built-in, and it is working.

We're using bluez 5.55 (`btmon -v`) which came stock, and turned off default
bluetooth:

```
sudo apt-get install bluetooth bluez libbluetooth-dev libudev-dev btusb
//check the verison installed
bluetoothd -v
sudo systemctl stop bluetooth
sudo systemctl disable bluetooth
```


To run, sometimes if the hci interface is in a bad state it can help to reset
it:

```
sudo hciconfig hci0 down; sleep 0.2; sudo hciconfig hci0 up; sleep 0.2; sudo node test_ble.js
```

### Always on with PM2

this needs to run as root because of HCI/BLE permissions.  PM2 is used to run
on startup and to maintain the script.

```
sudo npm install pm2@latest -g
sudo pm2 start stream_and_save.js
sudo pm2 startup
sudo pm2 save
```

process list in `/root/.pm2/dump.pm2'
script in `/etc/systemd/pm2-root.service`
logs in `/root/.pm2/logs/`
monitor with `sudo pm2 monit`


### other useful commands:

```
//scan for BLE devices
sudo hcitool -i hci0 lescan
//reset BLE interface, especially if cntrl+C out of a command
sudo hciconfig hci0 down
sudo hciconfig hci0 up
//connects to BLE device and gives interactive prompt ('connect', 'primary'
subcommands will allow connection from command-line)
sudo gatttool -i hci0 -b 80:E1:26:24:87:8D --interactive
//within gatttool
connect
mtu 512
char-desc
char-write-cmd 0x0019 00000000FDFD00000000000000FDFD000000
char-write-cmd 0x0019 00000000FD0000000000000000FD00000000
char-write-cmd 0x0019 0000000000FD0000000000000000FD000000
```



