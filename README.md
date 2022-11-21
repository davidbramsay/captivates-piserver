## Glasses and Watch BLE on Raspberry Pi 4B

This project is to automatically stream data from the captivates glasses and
equinox smartwatch to this device when they are in range. 

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

### TODO

<ol>
<li>(1) It should start on startup, and restart if dead. (PM2)
</li><li>(2) It should save data every few megabytes, or every two hours.
</li><li>(3) It should gracefully handle connect and disconnect events.
</li><li>(4) It should have an LED that is only on when things aren't working properly.
</li><li>(5) It should attempt to transition the color of the glasses ~20 min after
every time check detected on the watch for the user study; this should be
easily undone.
</li>
</ol>


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



