run sudo node index.js; it will contact the e4 streaming server on the IP included,
connect, and stream the data to website.  You can access the dashboard at this
computer's IP on port 8000.

Handles connects/disconnects gracefully.

```
sudo hciconfig hci0 down; sleep 0.2; sudo hciconfig hci0 up; sleep 0.2; sudo node index.js
```
