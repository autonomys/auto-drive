type FolderTreeFolder = {
    name: string;
    type: "folder";
    children: FolderTree[];
};

type FolderTreeFile = {
    name: string;
    type: "file";
    id: string;
};

export type FolderTree = FolderTreeFolder | FolderTreeFile;

export const constructFromFileList = (fileList: FileList): FolderTree => {
    const root: FolderTreeFolder = {
        name: "root",
        type: "folder",
        children: []
    };
    for (const file of Array.from(fileList)) {
        const pathParts = file.webkitRelativePath.split('/');
        let currentFolder = root;

        for (const [index, part] of Array.from(pathParts.entries())) {
            // Check if the part already exists in the current folder's children
            let existingFolder = currentFolder.children.find(child => child.name === part);

            if (!existingFolder) {
                // If it's the last part, create a file node
                if (index === pathParts.length - 1) {
                    const fileNode: FolderTreeFile = {
                        name: part,
                        type: "file",
                        id: getFileId(file)
                    };
                    currentFolder.children.push(fileNode);
                } else {
                    // Create a new folder node
                    const folderNode: FolderTreeFolder = {
                        name: part,
                        type: "folder",
                        children: []
                    };
                    currentFolder.children.push(folderNode);
                    existingFolder = folderNode;
                }
            }
            currentFolder = existingFolder as FolderTreeFolder; // Move to the next folder
        }
    }

    return root.children.length === 1 ? root.children[0] : root;
}

export const getFileId = (file: File) => {
    return `${file.webkitRelativePath}/${file.name}`;
}