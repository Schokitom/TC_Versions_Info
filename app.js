let API = null;

async function init() {

  API = await TrimbleConnectWorkspace.connect(window.parent);

  console.log("Trimble Extension verbunden");

}

init();
