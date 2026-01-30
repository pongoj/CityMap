const DB={
 db:null,
 init(){
  return new Promise((res,rej)=>{
   const r=indexedDB.open('citymap',1);
   r.onupgradeneeded=e=>{
    e.target.result.createObjectStore('markers',{keyPath:'id',autoIncrement:true});
   };
   r.onsuccess=e=>{this.db=e.target.result;res();};
   r.onerror=rej;
  });
 },
 addMarker(d){
  return new Promise(res=>{
   const tx=this.db.transaction('markers','readwrite');
   const s=tx.objectStore('markers');
   const r=s.add(d);
   r.onsuccess=()=>res(r.result);
  });
 },
 getAllMarkers(){
  return new Promise(res=>{
   const tx=this.db.transaction('markers','readonly');
   const s=tx.objectStore('markers');
   const r=s.getAll();
   r.onsuccess=()=>res(r.result);
  });
 },
 updateMarker(id,data){
  const tx=this.db.transaction('markers','readwrite');
  const s=tx.objectStore('markers');
  const r=s.get(id);
  r.onsuccess=()=>s.put({...r.result,...data});
 }
};
