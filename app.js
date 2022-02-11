const fs = require('fs');
const { createCanvas, loadImage, registerFont } = require('canvas');
const express = require('express');
const { DateTime } = require('luxon');

registerFont('./fonts/inter.ttf', { family: 'inter' });
registerFont('./fonts/outfit.ttf', { family: 'outfit' });

const data = fs.readFileSync('./data.txt', 'utf-8')
  .split('\n')
  .map(x => x.trim().split(/\s+/).map(parseFloat));

const app = express();

const MS_IN_DAY = 86400000;

// Settings
const width = 1200;
const height = 630;
const borderWidth = 4;
const margin = 20;
const fontSize = 200;
const textStart = { x: 100, y: 475 };
const defaultLat = 22;
const defaultLng = 120.301884;
const textures = {};
const starMaxSize = 20;
const moonSize = 200;

app.get('/', async (req, res) => {

  const now = DateTime.now().setZone('Asia/Taipei');
  const moonRise = now.set({
    hour: 18,
    minute: 0,
    second: 0,
    millisecond: 0
  });
  const raStart = now.set({
    hour: 15,
    minute: 0,
    second: 0,
    millisecond: 0
  });

  let fromRise = now.diff(moonRise).valueOf();
  let fromRaStart = now.diff(raStart).valueOf();

  if(fromRise < 0) { fromRise += MS_IN_DAY; }
  if(fromRaStart < 0) { fromRaStart += MS_IN_DAY; }

  const lat = req.query['lat'] !== undefined ? parseFloat(req.query['lat']) : defaultLat;
  const lng = req.query['lng'] !== undefined ? parseFloat(req.query['lng']) : (fromRaStart / MS_IN_DAY) * 360 - 180;

  if(isNaN(lat)) {
    res.status(400).json({error: 'Cannot parse latitude'});
    return;
  }

  if(isNaN(lng)) {
    res.status(400).json({error: 'Cannot parse longitude'});
    return;
  }

  if(lat < -90 || 90 < lat) {
    res.status(400).json({error: 'Latitude needs to be between -90 to 90 degrees'});
    return;
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = '#191716';
  ctx.fillRect(0, 0, width, height);

  ctx.lineWidth = borderWidth;
  ctx.strokeStyle = '#e0e2db';
  ctx.strokeRect(
    margin,
    margin,
    width - margin * 2,
    height - margin * 2
  );

  const moonTex = await loadTexture('moon');
  const textures = [
    await loadTexture('sparkle1'),
    await loadTexture('sparkle2'),
    await loadTexture('sparkle3'),
    await loadTexture('sparkle4'),
  ];

  ctx.globalCompositeOperation = 'exclusion';
  drawMoon(ctx, moonTex, (fromRise / MS_IN_DAY) * Math.PI * 2);
  plotStars(ctx, textures, lng, lat);

  ctx.save();
  ctx.font = `10px outfit`;

  const info = `RA ${lng.toFixed(2)} / Dec ${lat.toFixed(2)}`;
  const infoMetric = ctx.measureText(info);
  const infoWidth = infoMetric.width;

  ctx.fillStyle = '#e0e2db';
  ctx.fillText(
    info,
    width - 2 * margin - borderWidth - infoWidth,
    height - 2 * margin - borderWidth
  );
  ctx.restore();


  ctx.save();

  ctx.font = `${fontSize}px inter`;
  ctx.fillStyle = '#e0e2db';

  ctx.translate(0, height);
  ctx.rotate(-12 * Math.PI / 180);
  ctx.translate(0, -height);

  const metric = ctx.measureText('BY');
  const textHeight = metric.actualBoundingBoxAscent - metric.actualBoundingBoxDescent;

  ctx.fillText('BY', textStart.x, textStart.y - borderWidth);
  ctx.fillRect(0, textStart.y, 2000, borderWidth / 2);
  ctx.fillText('CHAO', textStart.x, textStart.y + textHeight + borderWidth / 2 + borderWidth);

  ctx.restore();

  const buffer = await Buffer.from(canvas.toBuffer('image/png'), 'binary');

  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': buffer.length
  });
  res.end(buffer);
});

async function loadTexture(key) {
  if (!textures[key]) {
    try {
      textures[key] = await loadImage(`images/${key}.png`);
    } catch (error) {
      console.error(error);
      return null;
    }
  }
  return textures[key];
}

function drawMoon(ctx, moonTex, t) {
  const half = moonSize / 2;
  const r = height - half;
  const x = width / 2 + r * Math.cos(t);
  const y = height - r * Math.sin(t);
  ctx.drawImage(moonTex, x - half, y - half, moonSize, moonSize);
}


function plotStars(ctx, textures, lng, lat) {

  ra0 = lng * Math.PI / 180;
  dec0 = lat * Math.PI / 180;

  const map = {
    44: 'Rigel',
    45:'Capella',
    71: 'Sirius',
    19: 'Polaris',
    60: 'Betelgeuse',
    67: 'Canopus',
    154: 'Arcturus',
    159: 'α Centauri',
    143: 'Spica',
  }

  // Loop over each star in turn
  for (let i = 0; i < data.length; i++) {
    let [ra, dec, mag] = data[i];

    // Convert to radians
    ra = ra * Math.PI / 180;
    dec = dec * Math.PI / 180;

    // Work out coordinates of this star on the star chart
    const { x, y } = stereographicProject(ra, dec, ra0, dec0);

    scale = height * (180 / Math.PI) / 175;
    xS = (width / 2) - (x * scale);
    yS = (height / 2) - (y * scale);

    // Calculate the radius of this star on tha canvas
    const size = starSize(mag);
    ctx.drawImage(textures[i % textures.length], xS, yS, size, size);
    if(map[i]) {
      ctx.save();
      ctx.font = `10px outfit`;
      ctx.fillStyle = '#e0e2db';
      ctx.fillText(map[i], xS + size, yS + size);
      //console.log(map[i], xS, yS);
      ctx.restore();
    }
  }
}

function starSize(mag) {
  if(mag <= 0) return starMaxSize;
  const size = Math.min(starMaxSize / mag, starMaxSize);
  return size;
}

function stereographicProject(ra, dec, ra0, dec0, posAngle) {

  // Orthographic
  const dRa = ra - ra0;
  const x1 = Math.cos(dec) * Math.sin(dRa);
  const y1 = Math.sin(dec) * Math.cos(dec0) -
             Math.cos(dec) * Math.sin(dec0) * Math.cos(dRa);
  const z1 = Math.sin(dec) * Math.sin(dec0) +
             Math.cos(dec) * Math.cos(dec0) * Math.cos(dRa);

  //return { x: x1, y: y1 };

  let d = 0;
  // Stereographic
  if( z1 < -.9) {
    d = 20 * Math.sqrt(( 1 - .81) / ( 1.00001 - z1 * z1));
  }
  else {
    d = 2 / (z1 + 1);
  }

  const x = d * x1;
  const y = d * y1;

  return { x, y };
}

app.use(express.static('public'));
const PORT = process.env.PORT || 8000;
app.listen(PORT);
console.log(`Application started and listening on port ${PORT}`);