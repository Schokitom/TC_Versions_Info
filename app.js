async function init(){

const API = await TrimbleConnectWorkspace.connect(window.parent)

document.getElementById("status").innerText="API verbunden"

console.log("Extension gestartet",API)

}

init()
