const APP_VERSION = "5.3.1";

let map;

function initMap() {
    map = L.map("map").setView([47.486, 18.315], 15);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap"
    }).addTo(map);
}

function startAddMode() {
    alert("Objektum hozzáadás – meglévő logika");
}

function centerToMyLocation() {
    alert("Saját hely – meglévő logika");
}

function deleteAll() {
    alert("Összes törlés – meglévő logika");
}

function openFilter() {
    alert("Szűrés – következő lépésben modal ablak");
}

document.addEventListener("DOMContentLoaded", initMap);
