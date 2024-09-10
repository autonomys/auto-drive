"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var dataHasher_js_1 = require("./src/utils/dataHasher.js");
var auto_drive_1 = require("@autonomys/auto-drive");
var folderTree = {
    name: "test",
    type: "folder",
    children: [
        {
            name: "test",
            type: "file",
            id: "file1",
        },
        {
            name: "folder",
            type: "folder",
            children: [
                {
                    name: "subfile",
                    type: "file",
                    id: "file2",
                },
                {
                    name: "subfolder",
                    type: "folder",
                    children: [
                        {
                            name: "subsubfile",
                            type: "file",
                            id: "file3",
                        },
                    ],
                },
            ],
        },
    ],
};
var base64 = "CgO16y0=";
console.log((0, auto_drive_1.cidToString)((0, dataHasher_js_1.hashData)(Buffer.from(base64, "base64"))));
