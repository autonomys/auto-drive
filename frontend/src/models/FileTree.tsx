// import JSZip from 'jszip';

// type FolderTreeFolder = {
//   name: string;
//   type: 'folder';
//   children: FolderTree[];
//   id: string;
// };

// type FolderTreeFile = {
//   name: string;
//   type: 'file';
//   id: string;
// };

// export const getTreeFiles = (
//   tree: FolderTree,
//   accumulatedPath: string,
// ): File[] => {
//   if (tree.type === 'file') {
//     return [{ ...tree, webkitRelativePath: accumulatedPath }];
//   }
//   return tree.children.flatMap(getTreeFiles);
// };

// export type FolderTree = FolderTreeFolder | FolderTreeFile;

// export const getFileId = (file: File) => {
//   return `${file.webkitRelativePath}/${file.name}`;
// };

// export const constructFromFileSystemEntries = (
//   entries: { file: File; path: string }[],
// ): [FolderTree, Record<string, File>] => {
//   const root: FolderTreeFolder = {
//     name: 'root',
//     type: 'folder',
//     children: [],
//     id: 'root',
//   };

//   const files: Record<string, File> = {};
//   for (const entry of entries) {
//     if (entry.file) {
//       files[entry.path] = entry.file;
//     }
//     const pathParts = entry.path.split('/').filter(Boolean);
//     let currentFolder = root;

//     for (const [index, part] of Array.from(pathParts.entries())) {
//       // Check if the part already exists in the current folder's children
//       let existingFolder = currentFolder.children.find(
//         (child) => child.name === part,
//       );

//       if (!existingFolder) {
//         // If it's the last part, create a file node
//         if (index === pathParts.length - 1) {
//           const fileNode: FolderTreeFile = {
//             name: part,
//             type: 'file',
//             id: entry.path,
//           };
//           currentFolder.children.push(fileNode);
//         } else {
//           // Create a new folder node
//           const folderNode: FolderTreeFolder = {
//             name: part,
//             type: 'folder',
//             children: [],
//             id: `${currentFolder.id.split('/').slice(1).join('/')}/${part}`,
//           };
//           currentFolder.children.push(folderNode);
//           existingFolder = folderNode;
//         }
//       }
//       currentFolder = existingFolder as FolderTreeFolder; // Move to the next folder
//     }
//   }

//   return [root.children.length === 1 ? root.children[0] : root, files];
// };

// const addFilesToZip = (
//   folder: JSZip,
//   folderNode: FolderTreeFolder,
//   files: Record<string, File>,
// ) => {
//   folderNode.children.forEach((child) => {
//     if (child.type === 'file') {
//       folder.file(child.name, files[child.id]);
//     } else if (child.type === 'folder') {
//       const subFolder = folder.folder(child.name);
//       if (!subFolder) {
//         throw new Error('Failed to create folder in zip');
//       }
//       addFilesToZip(subFolder, child as FolderTreeFolder, files);
//     }
//   });
// };

// export const constructZipBlob = (
//   tree: FolderTree,
//   files: Record<string, File>,
// ) => {
//   const zip = new JSZip();
//   if (tree.type === 'file') {
//     throw new Error('Cannot construct zip from file');
//   }

//   tree.children.forEach((node) => {
//     if (node.type === 'file') {
//       zip.file(node.name, files[node.id]);
//     } else if (node.type === 'folder') {
//       const folder = zip.folder(node.name);
//       if (!folder) {
//         throw new Error('Failed to create folder in zip');
//       }
//       addFilesToZip(folder, node as FolderTreeFolder, files);
//     }
//   });

//   return zip.generateAsync({ type: 'blob' });
// };
