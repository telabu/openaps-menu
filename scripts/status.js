
'use strict';

const i2c = require('i2c-bus');
const path = require('path');
const extend = require('extend');
var os = require('os');
var fs = require('fs');
var font = require('oled-font-5x7');
var i2cBus = i2c.openSync(1);

// Rounds value to 'digits' decimal places
function round(value, digits)
{
  if (! digits) { digits = 0; }
  var scale = Math.pow(10, digits);
  return Math.round(value * scale) / scale;
}

function convert_bg(value, profile)
{
  if (profile != null && profile.out_units == "mmol/L")
  {
    return round(value / 18, 1).toFixed(1);
  }
  else
  {
    return Math.round(value);
  }
}

function stripLeadingZero(value)
{
  var re = /^(-)?0+(?=[\.\d])/;
  return value.toString().replace( re, '$1');
}

//setup the display
var displayConfig = require('/root/src/openaps-menu/config/display.json');
displayConfig.i2cBus = i2cBus;

//check to see if the display works, exit with error code if it doesn't
try {
    var display = require('/root/src/openaps-menu/lib/display/ssd1306')(displayConfig);
} catch (e) {
    return console.error("Could not set up HAT display:\n", e);
}

//dim the display
display.oled.dimDisplay(true);

//Parse all the .json files we need
try {
    var profile = JSON.parse(fs.readFileSync("/root/myopenaps/settings/profile.json"));
} catch (e) {
    console.error("Status screen display error: could not parse profile.json: ", e);
}
try {
    var batterylevel = JSON.parse(fs.readFileSync("/root/myopenaps/monitor/edison-battery.json"));
} catch (e) {
    console.error("Status screen display error: could not parse edison-battery.json: ", e);
}
try {
    var status = JSON.parse(fs.readFileSync("/root/myopenaps/monitor/status.json"));
} catch (e) {
    console.error("Status screen display error: could not parse status.json: ", e);
}
try {
    var suggested = JSON.parse(fs.readFileSync("/root/myopenaps/enact/suggested.json"));
} catch (e) {
    console.error("Status screen display error: could not parse suggested.json: ", e);
}
try {
    var bg = JSON.parse(fs.readFileSync("/root/myopenaps/monitor/glucose.json"));
} catch (e) {
    console.error("Status screen display error: could not parse glucose.json: ", e);
}
try {
    var temp = JSON.parse(fs.readFileSync("/root/myopenaps/monitor/last_temp_basal.json"));
    var stats = fs.statSync("/root/myopenaps/monitor/last_temp_basal.json");
} catch (e) {
    console.error("Status screen display error: could not parse last_temp_basal.json: ", e);
}
try {
    var iob = JSON.parse(fs.readFileSync("/root/myopenaps/monitor/iob.json"));
} catch (e) {
    console.error("Status screen display error: could not parse iob.json: ", e);
}
try {
    var cob = JSON.parse(fs.readFileSync("/root/myopenaps/monitor/meal.json"));
} catch (e) {
    console.error("Status screen display error: could not parse meal.json: ", e);
}

//Process and display battery gauge
if(batterylevel) {
    display.oled.drawLine(116, 57, 127, 57, 1, false); //top
    display.oled.drawLine(116, 63, 127, 63, 1, false); //bottom
    display.oled.drawLine(116, 57, 116, 63, 1, false); //left
    display.oled.drawLine(127, 57, 127, 63, 1, false); //right
    display.oled.drawLine(115, 59, 115, 61, 1, false); //iconify
    var batt = Math.round(batterylevel.battery / 10);
    display.oled.fillRect(127-batt, 58, batt, 5, 1, false); //fill battery gauge
}

//display reason for not looping and move the graph to make room for the message and to draw attention to it!
var yOffset = 0;
if (status && suggested) {
    var notLoopingReason = suggested.reason;
    display.oled.setCursor(0,16);
    if (status.suspended == true) {
        display.oled.writeString(font, 1, "PUMP SUSPENDED", 1, true, false);
        yOffset = 3;
    }
    else if (status.bolusing == true) {
        display.oled.writeString(font, 1, "PUMP BOLULSING", 1, true, false);
        yOffset = 3;
    }
    else if (notLoopingReason.includes("CGM is calibrating")) {
        display.oled.writeString(font, 1, "CGM calib./???/noisy", 1, true, false);
        yOffset = 3;
    }
    else if (notLoopingReason.includes("CGM data is unchanged")) {
        display.oled.writeString(font, 1, "CGM data unchanged", 1, true, false);
        yOffset = 3;
    }
//add more on-screen warnings/messages here, maybe some special ones for xdrip-js users
}

//display targets high and low
if (profile) {
    var targetLow = Math.round( (21+yOffset) - ( ( profile.bg_targets.targets[0].low - 250 ) / 8 ) );
    var targetHigh = Math.round( (21+yOffset) - ( ( profile.bg_targets.targets[0].high - 250 ) / 8 ) );
    display.oled.drawLine(2, targetHigh, 5, targetHigh, 1, false);
    display.oled.drawLine(2, targetLow, 5, targetLow, 1, false);
}

if (bg) {
    //rander BG graph
    var numBGs = (suggested.predBGs != undefined) ? (72) : (120); //fill the whole graph with BGs if there are no predictions
    var date = new Date();
    var zerotime = date.getTime() - ((numBGs * 5) * 600);
    var zero_x = numBGs + 5;
    for (var i = 0; i < numBGs; i++) {
        if (bg[i] != null) {
            var x = zero_x + Math.round(((((bg[i].date - zerotime)/1000)/60)/5));
            var y = Math.round( (21+yOffset) - ( ( bg[i].glucose - 250 ) / 8 ) );
            //left and right boundaries
            if ( x < 5 ) x = 5;
            if ( x > 127 ) x = 127;
            //upper and lower boundaries
            if ( y < (21+yOffset) ) y = (21+yOffset);
            if ( y > (51+yOffset) ) y = (51+yOffset);
            display.oled.drawPixel([x, y, 1, false]);
            // if we have multiple data points within 3m, look further back to fill in the graph
            if ( bg[i-1] && bg[i-1].date - bg[i].date < 200000 ) {
                numBGs++;
            }
        }
    }

    //calculate timeago for BG
    var startDate = new Date(bg[0].date);
    var endDate = new Date();
    var minutes = Math.round(( (endDate.getTime() - startDate.getTime()) / 1000) / 60);
    if (bg[0].delta) {
        var delta = Math.round(bg[0].delta);
    } else if (bg[1] && bg[0].date - bg[1].date > 200000 ) {
        var delta = Math.round(bg[0].glucose - bg[1].glucose);
    } else if (bg[2] && bg[0].date - bg[2].date > 200000 ) {
        var delta = Math.round(bg[0].glucose - bg[2].glucose);
    } else if (bg[3] && bg[0].date - bg[3].date > 200000 ) {
        var delta = Math.round(bg[0].glucose - bg[3].glucose);
    } else {
        var delta = 0;
    }
    //display BG number and timeago, add plus sign if delta is positive
    display.oled.setCursor(0,57);
    if (delta >= 0) {
        display.oled.writeString(font, 1, "BG:"+convert_bg(bg[0].glucose, profile)+"+"+stripLeadingZero(convert_bg(delta, profile))+" "+minutes+"m", 1, true, false);
    } else {
        display.oled.writeString(font, 1, "BG:"+convert_bg(bg[0].glucose, profile)+""+stripLeadingZero(convert_bg(delta, profile))+" "+minutes+"m", 1, true, false);
    }
}

//render predictions, but only if we have them
if (suggested && suggested.predBGs != undefined) {
    //render line between actual BG and predicted
    x = zero_x + 1;
    display.oled.drawLine(x, 51+yOffset, x, 21+yOffset, 1, false);
    //render predictions
    var predictions = [suggested.predBGs.IOB, suggested.predBGs.ZT, suggested.predBGs.UAM, suggested.predBGs.COB];
    for (i = 0; i <= 48; i++) {
        x++;
        for(var n = 0; n <=3 && (predictions[n] != undefined); n++) {
        y = Math.round( (21+yOffset) - ( (predictions[n][i] - 250 ) / 8) );
        //right boundary
        if ( x > 127 ) x = 127;
        //upper and lower boundaries
        if ( y < (21+yOffset) ) y = (21+yOffset);
        if ( y > (51+yOffset) ) y = (51+yOffset);
        display.oled.drawPixel([x, y, 1, false]);
        }
    }
}

//display current temp basal and how long ago it was set
if (stats && temp) {
    startDate = new Date(stats.mtime);
    endDate = new Date();
    minutes = Math.round(( (endDate.getTime() - startDate.getTime()) / 1000) / 60);
    //display current temp basal
    display.oled.setCursor(0,0);
    var tempRate = Math.round(temp.rate*10)/10;
    display.oled.writeString(font, 1, "TB: "+temp.duration+'m '+tempRate+'U/h '+'('+minutes+'m ago)', 1, false);
}

//display COB and IOB on second line of the screen
if (iob && cob) {
    display.oled.setCursor(0,8);
    display.oled.writeString(font, 1, "COB: "+cob.mealCOB+"g  IOB: "+iob[0].iob+'U', 1, false, false);
}

//bg graph axes
display.oled.drawLine(5, 51+yOffset, 5, 21+yOffset, 1, false);
display.oled.drawLine(5, 51+yOffset, 127, 51+yOffset, 1, false);

//render clock
var clockDate = new Date();
var clockHour = clockDate.getHours();
clockHour = (clockHour < 10 ? "0" : "") + clockHour;
var clockMin  = clockDate.getMinutes();
clockMin = (clockMin < 10 ? "0" : "") + clockMin;
display.oled.setCursor(83, 57);
display.oled.writeString(font, 1, clockHour+":"+clockMin, 1, true, false);

//write to the screen
display.oled.update();

//randomly invert display to evenly wear the OLED diodes
display.oled.invertDisplay((endDate % 2 == 1));
