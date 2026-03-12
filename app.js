let API = null;
let files = [];

async function init(){

API = await TrimbleConnectWorkspace.connect(window.parent,onEvent);

document.getElementById("status").innerText="API verbunden";

const menu = {
title:"Versionsinfo",
icon:"https://meinserver.de/trimble-versionsinfo/icon.png",
command:"open_versionsinfo"
};

await API.extension.setMenu(menu);

loadProjectFiles();

initSearch();

}

function onEvent(event,args){

console.log(event,args);

if(event==="extension.command"){

if(args.data==="open_versionsinfo"){

document.body.scrollIntoView();

}

}

}

async function loadProjectFiles(){

const project = await API.project.getProject();

const folders = await API.project.getProjectFolders(project.id);

for(const folder of folders){

await scanFolder(folder);

}

renderTable(files);

}

async function scanFolder(folder){

const items = await API.project.getFolderItems(folder.id);

for(const item of items){

if(item.type==="folder"){

await scanFolder(item);

}

if(item.type==="file"){

if(item.name.toLowerCase().endsWith(".pdf")){

let versionCount=1;

try{

const versions=await API.project.getFileVersions(item.id);

versionCount=versions.length;

}catch(e){

console.log("Versionen konnten nicht geladen werden");

}

files.push({

name:item.name,
modifiedBy:item.modifiedBy||"",
modifiedOn:item.modifiedOn||"",
versions:versionCount,
path:item.path||""

});

}

}

}

}

function renderTable(list){

const tbody=document.querySelector("#fileTable tbody");

tbody.innerHTML="";

list.forEach(file=>{

const row=document.createElement("tr");

row.innerHTML=`

<td>${file.name}</td>
<td>${file.modifiedBy}</td>
<td>${formatDate(file.modifiedOn)}</td>
<td>${file.versions}</td>
<td>${file.path}</td>

`;

tbody.appendChild(row);

});

}

function formatDate(date){

if(!date)return "";

return new Date(date).toLocaleString();

}

function initSearch(){

const search=document.getElementById("search");

search.addEventListener("input",()=>{

const text=search.value.toLowerCase();

const filtered=files.filter(f=>

f.name.toLowerCase().includes(text)||
f.path.toLowerCase().includes(text)

);

renderTable(filtered);

});

}

init();
