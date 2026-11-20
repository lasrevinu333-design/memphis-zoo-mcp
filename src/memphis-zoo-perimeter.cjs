(function(root){
'use strict';
// Public geographic data: OpenStreetMap contributors, ODbL 1.0.
// Operational display boundary, not a survey or cleaning/NFC authority.
const record={"type":"Feature","id":"memphis-zoo-osm-11810360-20261119","geometry":{"type":"Polygon","coordinates":[[[-89.9977996,35.150348],[-89.9977983,35.1502896],[-89.997743,35.1502492],[-89.9955228,35.1500254],[-89.995438,35.1499985],[-89.9953742,35.1499475],[-89.9952801,35.14985],[-89.995255,35.149795],[-89.9952146,35.149701],[-89.9951064,35.1497241],[-89.9947075,35.1498211],[-89.9946366,35.1498398],[-89.9945177,35.1495387],[-89.9939499,35.1496847],[-89.9939441,35.1497465],[-89.992561,35.1496256],[-89.9922095,35.1495911],[-89.9922328,35.1493988],[-89.9922049,35.1493673],[-89.9921668,35.1493243],[-89.9920374,35.1492351],[-89.9919198,35.1491541],[-89.9919162,35.149158],[-89.9917854,35.1491183],[-89.991672,35.1490699],[-89.99158,35.1489998],[-89.9915226,35.1489171],[-89.9914893,35.1488151],[-89.9914547,35.1487323],[-89.9914091,35.1486651],[-89.9913327,35.1486162],[-89.9912174,35.1485782],[-89.9910405,35.1485241],[-89.9909674,35.1484882],[-89.9909204,35.1484523],[-89.9909056,35.1483967],[-89.9905884,35.1483611],[-89.9904817,35.1484222],[-89.9887159,35.1490254],[-89.9875988,35.148924],[-89.9874406,35.1489304],[-89.9876071,35.1493266],[-89.9881044,35.1502601],[-89.9880776,35.1503851],[-89.9879478,35.1505893],[-89.9877783,35.1514695],[-89.9921943,35.1518962],[-89.9973152,35.1523953],[-89.9973979,35.1524056],[-89.9974328,35.152403],[-89.9974698,35.1523849],[-89.9974959,35.1523533],[-89.9975143,35.1522664],[-89.9975552,35.1520016],[-89.997658,35.1512126],[-89.9977996,35.150348]]]},"properties":{"schema":"custodial.zoo-display-perimeter.v1","purpose":"Advisory assigned-phone display only; no cleaning/NFC/geofence authority","source":{"name":"OpenStreetMap contributors","relation":11810360,"url":"https://www.openstreetmap.org/relation/11810360","license":"ODbL-1.0","copyright_url":"https://www.openstreetmap.org/copyright","retrieved_at":"2026-11-20T02:55:24Z","member_ways":[{"id":105087041,"version":12,"timestamp":"2026-06-17T20:22:10Z"},{"id":865206654,"version":2,"timestamp":"2026-05-27T22:02:10Z"},{"id":865206665,"version":4,"timestamp":"2026-05-27T22:02:10Z"}]}}};
const finite=Number.isFinite;
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const ring=record.geometry.coordinates[0];
if(record.geometry.type!=='Polygon'||record.geometry.coordinates.length!==1||ring.length!==56
 ||ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1]
 ||ring.some(p=>p.length!==2||!p.every(finite)||Math.abs(p[0])>180||Math.abs(p[1])>90))throw Error('Zoo perimeter data invalid');
function contains(latitude,longitude){
 if(!finite(latitude)||!finite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return false;
 let inside=false;
 for(let i=0,j=ring.length-2;i<ring.length-1;j=i++){
  const a=ring[j],b=ring[i],ax=a[0]-longitude,ay=a[1]-latitude,bx=b[0]-longitude,by=b[1]-latitude;
  const cross=ax*by-ay*bx;
  // Floating-point orientation roundoff only; this adds no geographic buffer.
  const roundoff=8*Number.EPSILON*(Math.abs(ax*by)+Math.abs(ay*bx));
  if(Math.abs(cross)<=roundoff&&longitude>=Math.min(a[0],b[0])&&longitude<=Math.max(a[0],b[0])
    &&latitude>=Math.min(a[1],b[1])&&latitude<=Math.max(a[1],b[1]))return true;
  if((a[1]>latitude)!==(b[1]>latitude)&&longitude<(b[0]-a[0])*(latitude-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}
freeze(record);
const api=Object.freeze({record,contains,id:record.id});root.MemphisZooPerimeter=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
