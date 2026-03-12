let API = null
let files = []

async function init(){

API = await TrimbleConnectWorkspace.connect(window.parent, onEvent)

document.getElementById("status").innerText="API verbunden"

// Extension registrieren

await API.extension.register({

title:"Versionsinfo",
icon:"https://meinserver.de/trimble-versionsinfo/icon.png",

menu:{
location:"main",
command:"openVersions"
}

})

}

function onEvent(event,args){

console.log(event,args)

if(event==="extension.command"){

if(args.data==="openVersions"){

loadFiles()

}

}

}

async function loadFiles(){

const project = await API.project.getProject()

const folders = await API.project.getProjectFolders(project.id)

for(const folder of folders){

await scanFolder(folder)

}

render(files)

}

async function scanFolder(folder){

const items = await API.project.getFolderItems(folder.id)

for(const item of items){

if(item.type==="folder"){

await scanFolder(item)

}

if(item.type==="file"){

if(item.name.toLowerCase().endsWith(".pdf")){

let versionCount=1

try{

const versions=await API.project.getFileVersions(item.id)

versionCount=versions.length

}catch(e){}

files.push({

name:item.name,
modifiedBy:item.modifiedBy||"",
modifiedOn:item.modifiedOn||"",
versions:versionCount,
path:item.path||""

})

}

}

}

}

function render(list){

const tbody=document.querySelector("#table tbody")

tbody.innerHTML=""

list.forEach(f=>{

const row=document.createElement("tr")

row.innerHTML=`

<td>${f.name}</td>
<td>${f.modifiedBy}</td>
<td>${formatDate(f.modifiedOn)}</td>
<td>${f.versions}</td>
<td>${f.path}</td>

`

tbody.appendChild(row)

})

}

function formatDate(d){

if(!d)return""

return new Date(d).toLocaleString()

}

init()
