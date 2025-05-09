const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { parseStringPromise } = require('xml2js');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    mainWindow.loadFile('index.html');
}

function registerHandlers() {
    // Diálogo para abrir archivo
    ipcMain.handle('dialog:openFile', async () => {
        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openFile'],
                filters: [
                    { name: 'Archivos XML', extensions: ['xml'] },
                    { name: 'Todos los archivos', extensions: ['*'] },
                ],
            });

            if (result.canceled) return null;

            const filePath = result.filePaths[0];
            return {
                path: filePath,
                name: path.basename(filePath),
                size: `${(fs.statSync(filePath).size / 1024).toFixed(2)} KB`
            };
        } catch (error) {
            console.error('Error en dialog:openFile:', error);
            throw error;
        }
    });

    // Extraer marcas comerciales
    ipcMain.handle('extract-brands', async (_, filePath) => {
        try {
            const xmlContent = fs.readFileSync(filePath, 'utf-8');
            const matches = xmlContent.match(/<Covol:MarcaComercial>(.*?)<\/Covol:MarcaComercial>/g) || [];
            const brands = new Set(matches.map(m => m.replace(/<\/?Covol:MarcaComercial>/g, '')));
            return Array.from(brands);
        } catch (error) {
            console.error('Error en extract-brands:', error);
            throw new Error('Error al extraer marcas comerciales del archivo');
        }
    });

    // Buscar etiquetas en mayúsculas
    ipcMain.handle('find-uppercase-tags', async (_, filePath, brandName) => {
        try {
            if (!filePath || !brandName) throw new Error('Parámetros incompletos');
            return ['RECEPCIONES', 'ENTREGAS', 'CONTROLDEEXISTENCIAS'];
        } catch (error) {
            console.error('Error en find-uppercase-tags:', error);
            throw error;
        }
    });

    // Extraer etiquetas fijas
    ipcMain.handle('extract-fixed-tags', async (_, filePath) => {
        try {
            const xmlContent = fs.readFileSync(filePath, 'utf-8');
            const descMatch = xmlContent.match(/<Covol:DescripcionInstalacion>(.*?)<\/Covol:DescripcionInstalacion>/);
            const numPermisoMatch = xmlContent.match(/<Covol:NumPermiso>(.*?)<\/Covol:NumPermiso>/);

            if (!descMatch || !numPermisoMatch) {
                throw new Error('El archivo no contiene las etiquetas requeridas');
            }

            return {
                descripcionInstalacion: descMatch[1].trim(),
                numPermiso: numPermisoMatch[1].trim()
            };
        } catch (error) {
            console.error('Error en extract-fixed-tags:', error);
            throw new Error('Error al extraer datos fijos del archivo');
        }
    });

    // Buscar contenido de etiqueta específica
    ipcMain.handle('find-tag-content', async (_, filePath, brandName, uppercaseTag, tagName) => {
        try {
            const xmlContent = fs.readFileSync(filePath, 'utf-8');
            const brandBlock = xmlContent.match(
                new RegExp(`<Covol:MarcaComercial>${brandName}<\/Covol:MarcaComercial>([\\s\\S]*?)(?=<Covol:MarcaComercial>|$)`, 'i')
            )?.[1];

            if (!brandBlock) return null;

            const uppercaseBlock = brandBlock.match(
                new RegExp(`<Covol:${uppercaseTag}>([\\s\\S]*?)<\/Covol:${uppercaseTag}>`, 'i')
            )?.[1];

            if (!uppercaseBlock) return null;

            const tagMatch = uppercaseBlock.match(
                new RegExp(`<Covol:${tagName}>([\\s\\S]*?)<\/Covol:${tagName}>`, 'i')
            );

            return tagMatch?.[1]?.trim() || null;
        } catch (error) {
            console.error('Error en find-tag-content:', error);
            throw error;
        }
    });

    // Guardar archivo
    ipcMain.handle('save-file', async (_, { content, defaultName = 'documento_generado.xml' }) => {
        try {
            const contentStr = (typeof content === 'object') ? JSON.stringify(content) : String(content);
            
            const result = await dialog.showSaveDialog({
                title: 'Guardar documento',
                defaultPath: defaultName,
                filters: [
                    { name: 'XML', extensions: ['xml'] },
                    { name: 'Texto', extensions: ['txt'] }
                ]
            });

            if (!result.canceled && result.filePath) {
                fs.writeFileSync(result.filePath, contentStr, 'utf-8');
                return result.filePath;
            }
            return null;
        } catch (error) {
            console.error('Error en save-file:', error);
            throw new Error('Error al guardar el archivo');
        }
    });
}

app.whenReady().then(() => {
    registerHandlers();
    createWindow();
});

app.on('window-all-closed', () => app.quit());