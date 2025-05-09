const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { parseStringPromise } = require('xml2js');
const PDFDocument = require('pdfkit'); // Necesitarás instalar: npm install pdfkit

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false,
            sandbox: true
        }
    });

    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools();
}

function setupIPCHandlers() {
    // Diálogo para abrir archivo
    ipcMain.handle('dialog:openFile', async () => {
        const { filePaths, canceled } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'XML Files', extensions: ['xml'] }]
        });
        
        if (canceled || filePaths.length === 0) return null;

        const filePath = filePaths[0];
        const stats = fs.statSync(filePath);
        const fileSize = (stats.size / 1024).toFixed(2) + ' KB';
        
        return {
            path: filePath,
            name: path.basename(filePath),
            size: fileSize
        };
    });

    // Diálogo para guardar archivo
    ipcMain.handle('dialog:saveFile', async (_, { content, defaultName }) => {
        const { filePath, canceled } = await dialog.showSaveDialog({
            defaultPath: defaultName,
            filters: [
                { name: 'PDF Files', extensions: ['pdf'] },
                { name: 'Text Files', extensions: ['txt'] }
            ]
        });

        if (canceled || !filePath) return null;

        // Determinar el tipo de archivo por extensión
        const ext = path.extname(filePath).toLowerCase();
        
        if (ext === '.pdf') {
            // Generar PDF
            const doc = new PDFDocument();
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);
            
            // Contenido del PDF
            doc.fontSize(20).text(content.header.title, { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(`Instalación: ${content.header.installation}`);
            doc.text(`Permiso: ${content.header.permit}`);
            doc.text(`Fecha: ${content.header.date}`);
            doc.moveDown();
            
            doc.fontSize(16).text('Datos del Reporte:');
            content.content.forEach(item => {
                doc.moveDown();
                doc.font('Helvetica-Bold').text(`${item.label}:`);
                doc.font('Helvetica').text(item.value);
            });
            
            doc.end();
        } else {
            // Guardar como TXT (o cualquier otro formato)
            fs.writeFileSync(filePath, content, 'utf-8');
        }

        return filePath;
    });

    // Extraer marcas comerciales
    ipcMain.handle('data:extractBrands', async (_, filePath) => {
        try {
            const xmlContent = fs.readFileSync(filePath, 'utf-8');
            const matches = xmlContent.match(/<Covol:MarcaComercial>(.*?)<\/Covol:MarcaComercial>/g) || [];
            const brands = new Set(matches.map(m => m.replace(/<\/?Covol:MarcaComercial>/g, '')));
            return Array.from(brands);
        } catch (error) {
            console.error('Error al extraer marcas:', error);
            throw new Error('Error al procesar el archivo XML');
        }
    });

    // Obtener subetiquetas por categoría principal
    ipcMain.handle('data:getSubtags', async (_, { filePath, brandName, mainTag }) => {
        try {
            // Mapeo de categorías principales a sus subetiquetas
            const tagStructure = {
                'RECEPCIONES': [
                    'TotalRecepcionesMes',
                    'ValorNumerico',
                    'TotalDocumentosMes',
                    'ImporteTotalRecepciones'
                ],
                'ENTREGAS': [
                    'TotalEntregasMes',
                    'ValorNumerico',
                    'TotalDocumentosMes',
                    'ImporteTotalEntregasMes'
                ],
                'CONTROLDEEXISTENCIAS': [
                    'ValorNumerico',
                    'FechaYHoraEstaMedicionMes'
                ]
            };

            return tagStructure[mainTag] || [];
        } catch (error) {
            console.error('Error al obtener subetiquetas:', error);
            throw error;
        }
    });

    // Obtener valores de subetiquetas
    ipcMain.handle('data:getValues', async (_, { filePath, brandName, mainTag, subtags }) => {
        try {
            const xmlContent = fs.readFileSync(filePath, 'utf-8');
            const result = await parseStringPromise(xmlContent, {
                explicitArray: false,
                ignoreAttrs: true,
                tagNameProcessors: [name => name.replace('Covol:', '')]
            });

            // Buscar recursivamente los valores
            const findValues = (node, context = { inBrand: false, inMainTag: false }) => {
                if (!node) return {};

                // Actualizar contexto
                if (node.MarcaComercial === brandName) context.inBrand = true;
                if (node[mainTag]) context.inMainTag = true;

                // Recolectar valores si estamos en el contexto correcto
                const values = {};
                if (context.inBrand && context.inMainTag && node[mainTag]) {
                    subtags.forEach(subtag => {
                        if (node[mainTag][subtag]) {
                            values[subtag] = node[mainTag][subtag];
                        }
                    });
                    return values;
                }

                // Buscar recursivamente
                for (const key in node) {
                    if (typeof node[key] === 'object') {
                        const found = findValues(node[key], { ...context });
                        if (Object.keys(found).length > 0) return found;
                    }
                }

                return {};
            };

            return findValues(result);
        } catch (error) {
            console.error('Error al obtener valores:', error);
            throw error;
        }
    });

    // Generar reporte
    ipcMain.handle('report:generate', async (_, { data, formatType }) => {
        try {
            const fileName = `reporte_${new Date().toISOString().slice(0,10)}.${formatType}`;
            const { filePath, canceled } = await dialog.showSaveDialog({
                defaultPath: fileName,
                filters: [
                    { name: 'PDF Files', extensions: ['pdf'] },
                    { name: 'Text Files', extensions: ['txt'] }
                ]
            });

            if (canceled || !filePath) return null;

            if (formatType === 'pdf') {
                // Generar PDF usando pdfkit
                const doc = new PDFDocument();
                const stream = fs.createWriteStream(filePath);
                doc.pipe(stream);

                // Encabezado
                doc.fontSize(20).text(data.header.title, { align: 'center' });
                doc.moveDown();
                doc.fontSize(12)
                    .text(`Instalación: ${data.header.installation}`)
                    .text(`Permiso: ${data.header.permit}`)
                    .text(`Fecha: ${data.header.date}`);
                doc.moveDown();

                // Contenido
                doc.fontSize(16).text('Datos del Producto:');
                doc.moveDown();
                data.content.forEach(item => {
                    doc.font('Helvetica-Bold').text(`${item.label}:`);
                    doc.font('Helvetica').text(item.value.toString());
                    doc.moveDown();
                });

                doc.end();
            } else {
                // Guardar como TXT
                fs.writeFileSync(filePath, data, 'utf-8');
            }

            return filePath;
        } catch (error) {
            console.error('Error al generar reporte:', error);
            throw error;
        }
    });

    // Extraer metadatos
    ipcMain.handle('data:extractMetadata', async (_, filePath) => {
        try {
            const xmlContent = fs.readFileSync(filePath, 'utf-8');
            const descMatch = xmlContent.match(/<Covol:DescripcionInstalacion>(.*?)<\/Covol:DescripcionInstalacion>/);
            const permisoMatch = xmlContent.match(/<Covol:NumPermiso>(.*?)<\/Covol:NumPermiso>/);

            return {
                descripcionInstalacion: descMatch?.[1]?.trim() || 'No especificado',
                numPermiso: permisoMatch?.[1]?.trim() || 'No especificado'
            };
        } catch (error) {
            console.error('Error al extraer metadatos:', error);
            throw error;
        }
    });
}

app.whenReady().then(() => {
    setupIPCHandlers();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});