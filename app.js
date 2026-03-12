let API = null
let allFiles = []

async function init() {

API = await TrimbleConnectWorkspace.connect(window.parent)

addMenu()

loadFiles()

initSearch()

}

async function addMenu() {

await API.extension.setMainMenu({

title: "Versionsinfo",
command: "versionsinfo.open"

})

}

async function loadFiles() {

const project = await API.project.getProject()

const root = await API.project.getProjectFolders(project.id)

for (const folder of root) {

await scanFolder(folder)

}

renderTable(allFiles)

}

async function scanFolder(folder) {

const items = await API.project.getFolderItems(folder.id)

for (const item of items) {

if (item.type === "folder") {

await scanFolder(item)

}

if (item.type === "file") {

if (item.name.toLowerCase().endsWith(".pdf")) {

const versions = await API.project.getFileVersions(item.id)

allFiles.push({

name: item.name,
modifiedBy: item.modifiedBy,
modifiedOn: item.modifiedOn,
versions: versions.length,
path: item.path

})

}

}

}

}

function renderTable(files) {

const tbody = document.querySelector("#fileTable tbody")

tbody.innerHTML = ""

files.forEach(file => {

const row = document.createElement("tr")

row.innerHTML = `
<td>${file.name}</td>
<td>${file.modifiedBy || ""}</td>
<td>${formatDate(file.modifiedOn)}</td>
<td>${file.versions}</td>
<td>${file.path || ""}</td>
`

tbody.appendChild(row)

})

}

function formatDate(date) {

if (!date) return ""

return new Date(date).toLocaleString()

}

function initSearch() {

const search = document.getElementById("search")

search.addEventListener("input", () => {

const text = search.value.toLowerCase()

const filtered = allFiles.filter(f =>
f.name.toLowerCase().includes(text) ||
f.path.toLowerCase().includes(text)
)

renderTable(filtered)

})

}

init()
