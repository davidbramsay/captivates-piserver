run node index.js; it will contact the e4 streaming server on the IP included,
connect, and stream the data to website.  You can access the dashboard at this
computer's IP on port 8000.

TODO

(1) It currently won't connect if the e4 streaming server isn't running first, and
doesn't handle disconnects/retries gracefully.

(2) It doesn't save the data to a csv.

(3) It doesn't include glasses and watch data.

(4) It doesn't show LED state of glasses.



Colors:

Orange: #E53D00
Yellow: #FFE900
Teal: #008080
Blue: #000080
Light Grey: #D9D9D9
Dark Text: #2B303B
