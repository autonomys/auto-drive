/* tslint:disable */
/* eslint-disable */
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import type { TsoaRoute } from '@tsoa/runtime';
import {  fetchMiddlewares, ExpressTemplateService } from '@tsoa/runtime';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { UploadController } from './../http/controllers/upload.js';
import { expressAuthentication } from './../services/auth/express.js';
// @ts-ignore - no great way to install types from subpackage
import type { Request as ExRequest, Response as ExResponse, RequestHandler, Router } from 'express';
import multer from 'multer';


const expressAuthenticationRecasted = expressAuthentication as (req: ExRequest, securityName: string, scopes?: string[], res?: ExResponse) => Promise<any>;


// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

const models: TsoaRoute.Models = {
    "UploadType": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["file"]},{"dataType":"enum","enums":["folder"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UploadStatus": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["pending"]},{"dataType":"enum","enums":["migrating"]},{"dataType":"enum","enums":["cancelled"]},{"dataType":"enum","enums":["failed"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CompressionAlgorithm": {
        "dataType": "refEnum",
        "enums": ["ZLIB"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CompressionOptions": {
        "dataType": "refObject",
        "properties": {
            "algorithm": {"ref":"CompressionAlgorithm","required":true},
            "level": {"dataType":"double"},
            "chunkSize": {"dataType":"double"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EncryptionAlgorithm": {
        "dataType": "refEnum",
        "enums": ["AES_256_GCM"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EncryptionOptions": {
        "dataType": "refObject",
        "properties": {
            "algorithm": {"ref":"EncryptionAlgorithm","required":true},
            "chunkSize": {"dataType":"double"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FileUploadOptions": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"encryption":{"ref":"EncryptionOptions"},"compression":{"ref":"CompressionOptions"}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FileUpload": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "rootId": {"dataType":"string","required":true},
            "relativeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "type": {"ref":"UploadType","required":true},
            "status": {"ref":"UploadStatus","required":true},
            "fileTree": {"dataType":"enum","enums":[null],"required":true},
            "name": {"dataType":"string","required":true},
            "mimeType": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "oauthProvider": {"dataType":"string","required":true},
            "oauthUserId": {"dataType":"string","required":true},
            "uploadOptions": {"dataType":"union","subSchemas":[{"ref":"FileUploadOptions"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ErrorResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"details":{"dataType":"string"},"error":{"dataType":"string","required":true}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ApiResponse_FileUpload_": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"FileUpload"},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FileFileTree": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"type":{"dataType":"enum","enums":["file"],"required":true},"name":{"dataType":"string","required":true},"id":{"dataType":"string","required":true}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FolderFileTree": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"children":{"dataType":"array","array":{"dataType":"refAlias","ref":"FileTree"},"required":true},"name":{"dataType":"string","required":true},"type":{"dataType":"enum","enums":["folder"],"required":true},"id":{"dataType":"string","required":true}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FileTree": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"FileFileTree"},{"ref":"FolderFileTree"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FolderUpload": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "rootId": {"dataType":"string","required":true},
            "relativeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "type": {"ref":"UploadType","required":true},
            "status": {"ref":"UploadStatus","required":true},
            "fileTree": {"ref":"FolderFileTree","required":true},
            "name": {"dataType":"string","required":true},
            "mimeType": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "oauthProvider": {"dataType":"string","required":true},
            "oauthUserId": {"dataType":"string","required":true},
            "uploadOptions": {"dataType":"enum","enums":[null],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ApiResponse_FolderUpload_": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"FolderUpload"},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ApiResponse____": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"nestedObjectLiteral","nestedProperties":{}},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ApiResponse__cid-string__": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"nestedObjectLiteral","nestedProperties":{"cid":{"dataType":"string","required":true}}},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
};
const templateService = new ExpressTemplateService(models, {"noImplicitAdditionalProperties":"throw-on-extras","bodyCoercion":true});

// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa




export function RegisterRoutes(app: Router,opts?:{multer?:ReturnType<typeof multer>}) {

    // ###########################################################################################################
    //  NOTE: If you do not see routes for all of your controllers in this file, then you might not have informed tsoa of where to look
    //      Please look into the "controllerPathGlobs" config option described in the readme: https://github.com/lukeautry/tsoa
    // ###########################################################################################################

    const upload = opts?.multer ||  multer({"limits":{"fileSize":8388608}});

    
        const argsUploadController_createFileUpload: Record<string, TsoaRoute.ParameterSchema> = {
                requestBody: {"in":"body","name":"requestBody","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"uploadOptions":{"dataType":"any"},"filename":{"dataType":"string","required":true},"mimeType":{"dataType":"string"}}},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
        };
        app.post('/uploads/file',
            authenticateMiddleware([{"auth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(UploadController)),
            ...(fetchMiddlewares<RequestHandler>(UploadController.prototype.createFileUpload)),

            async function UploadController_createFileUpload(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsUploadController_createFileUpload, request, response });

                const controller = new UploadController();

              await templateService.apiHandler({
                methodName: 'createFileUpload',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUploadController_createFolderUpload: Record<string, TsoaRoute.ParameterSchema> = {
                requestBody: {"in":"body","name":"requestBody","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"uploadOptions":{"dataType":"any"},"fileTree":{"dataType":"any","required":true}}},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
        };
        app.post('/uploads/folder',
            ...(fetchMiddlewares<RequestHandler>(UploadController)),
            ...(fetchMiddlewares<RequestHandler>(UploadController.prototype.createFolderUpload)),

            async function UploadController_createFolderUpload(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsUploadController_createFolderUpload, request, response });

                const controller = new UploadController();

              await templateService.apiHandler({
                methodName: 'createFolderUpload',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUploadController_createFileInFolder: Record<string, TsoaRoute.ParameterSchema> = {
                uploadId: {"in":"path","name":"uploadId","required":true,"dataType":"string"},
                requestBody: {"in":"body","name":"requestBody","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"uploadOptions":{"dataType":"any"},"relativeId":{"dataType":"string","required":true},"mimeType":{"dataType":"string"},"name":{"dataType":"string","required":true}}},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
        };
        app.post('/uploads/folder/:uploadId/file',
            ...(fetchMiddlewares<RequestHandler>(UploadController)),
            ...(fetchMiddlewares<RequestHandler>(UploadController.prototype.createFileInFolder)),

            async function UploadController_createFileInFolder(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsUploadController_createFileInFolder, request, response });

                const controller = new UploadController();

              await templateService.apiHandler({
                methodName: 'createFileInFolder',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUploadController_uploadChunk: Record<string, TsoaRoute.ParameterSchema> = {
                uploadId: {"in":"path","name":"uploadId","required":true,"dataType":"string"},
                file: {"in":"formData","name":"file","required":true,"dataType":"file"},
                index: {"in":"formData","name":"index","required":true,"dataType":"string"},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
        };
        app.post('/uploads/file/:uploadId/chunk',
            upload.fields([
                {
                    name: "file",
                    maxCount: 1
                }
            ]),
            ...(fetchMiddlewares<RequestHandler>(UploadController)),
            ...(fetchMiddlewares<RequestHandler>(UploadController.prototype.uploadChunk)),

            async function UploadController_uploadChunk(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsUploadController_uploadChunk, request, response });

                const controller = new UploadController();

              await templateService.apiHandler({
                methodName: 'uploadChunk',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUploadController_completeUpload: Record<string, TsoaRoute.ParameterSchema> = {
                uploadId: {"in":"path","name":"uploadId","required":true,"dataType":"string"},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
        };
        app.post('/uploads/:uploadId/complete',
            ...(fetchMiddlewares<RequestHandler>(UploadController)),
            ...(fetchMiddlewares<RequestHandler>(UploadController.prototype.completeUpload)),

            async function UploadController_completeUpload(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsUploadController_completeUpload, request, response });

                const controller = new UploadController();

              await templateService.apiHandler({
                methodName: 'completeUpload',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa


    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

    function authenticateMiddleware(security: TsoaRoute.Security[] = []) {
        return async function runAuthenticationMiddleware(request: any, response: any, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            // keep track of failed auth attempts so we can hand back the most
            // recent one.  This behavior was previously existing so preserving it
            // here
            const failedAttempts: any[] = [];
            const pushAndRethrow = (error: any) => {
                failedAttempts.push(error);
                throw error;
            };

            const secMethodOrPromises: Promise<any>[] = [];
            for (const secMethod of security) {
                if (Object.keys(secMethod).length > 1) {
                    const secMethodAndPromises: Promise<any>[] = [];

                    for (const name in secMethod) {
                        secMethodAndPromises.push(
                            expressAuthenticationRecasted(request, name, secMethod[name], response)
                                .catch(pushAndRethrow)
                        );
                    }

                    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

                    secMethodOrPromises.push(Promise.all(secMethodAndPromises)
                        .then(users => { return users[0]; }));
                } else {
                    for (const name in secMethod) {
                        secMethodOrPromises.push(
                            expressAuthenticationRecasted(request, name, secMethod[name], response)
                                .catch(pushAndRethrow)
                        );
                    }
                }
            }

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            try {
                request['user'] = await Promise.any(secMethodOrPromises);

                // Response was sent in middleware, abort
                if (response.writableEnded) {
                    return;
                }

                next();
            }
            catch(err) {
                // Show most recent error as response
                const error = failedAttempts.pop();
                error.status = error.status || 401;

                // Response was sent in middleware, abort
                if (response.writableEnded) {
                    return;
                }
                next(error);
            }

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        }
    }

    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
}

// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
