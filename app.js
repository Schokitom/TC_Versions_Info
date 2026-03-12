async function init() {

const API = await TrimbleConnectWorkspace.connect(window.parent);

await API.extension.setMainMenu({
title: "Versionsinfo",
command: "versionsinfo"
});

}

init();
