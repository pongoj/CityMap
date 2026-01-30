let map;
let tempLatLng=null;

document.addEventListener('DOMContentLoaded', async()=>{
 map=L.map('map').setView([47.5,19.0],15);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

 map.on('click',e=>openDialog(e.latlng));
 btnAdd.onclick=()=>alert('Kattints a térképre');

 btnCancel.onclick=closeDialog;
 btnSave.onclick=saveMarker;

 await DB.init();
 loadMarkers();
});

function openDialog(latlng){
 tempLatLng=latlng;
 markerModal.style.display='flex';
}

function closeDialog(){
 markerModal.style.display='none';
 tempLatLng=null;
}

async function saveMarker(){
 const data={
  address:fAddress.value,
  type:fType.value,
  state:fState.value,
  lat:tempLatLng.lat,
  lng:tempLatLng.lng
 };
 const id=await DB.addMarker(data);
 addMarker({...data,id});
 closeDialog();
}

function addMarker(m){
 const mk=L.marker([m.lat,m.lng],{draggable:true}).addTo(map);
 mk.bindPopup(`<b>${m.type}</b><br>${m.address}<br>${m.state}`);
 mk.on('dragend',e=>{
  const p=e.target.getLatLng();
  DB.updateMarker(m.id,{lat:p.lat,lng:p.lng});
 });
}

async function loadMarkers(){
 const all=await DB.getAllMarkers();
 all.forEach(addMarker);
}
