const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { parseStringPromise } = require('xml2js');
const PDFDocument = require('pdfkit');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
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
            filters: [
                { name: 'XML Files', extensions: ['xml'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });
        
        if (canceled || filePaths.length === 0) return null;

        const filePath = filePaths[0];
        const stats = fs.statSync(filePath);
        const fileSize = formatFileSize(stats.size);
        
        return {
            path: filePath,
            name: path.basename(filePath),
            size: fileSize
        };
    });

    // Extraer marcas comerciales del XML
    ipcMain.handle('data:extractBrands', async (_, filePath) => {
        try {
            const xmlContent = fs.readFileSync(filePath, 'utf-8');
            const matches = xmlContent.match(/<Covol:MarcaComercial>(.*?)<\/Covol:MarcaComercial>/g) || [];
            const brands = new Set(
                matches.map(m => m.replace(/<\/?Covol:MarcaComercial>/g, '').trim())
                .filter(brand => brand)
            );
            return Array.from(brands);
        } catch (error) {
            console.error('Error al extraer marcas:', error);
            throw new Error('Error al procesar el archivo XML');
        }
    });

    // Obtener valores de subetiquetas para múltiples marcas
    ipcMain.handle('data:getValues', async (_, { filePath, brandName, mainTag, subtags }) => {
        try {
            const xmlContent = fs.readFileSync(filePath, 'utf-8');
            const result = await parseStringPromise(xmlContent, {
                explicitArray: false,
                ignoreAttrs: true,
                tagNameProcessors: [name => name.replace('Covol:', '')],
                trim: true
            });

            // Función recursiva para buscar valores
            const findValues = (node, context = { inBrand: false, inMainTag: false }) => {
                if (!node) return {};

                // Verificar contexto de marca
                if (node.MarcaComercial === brandName) context.inBrand = true;
                if (node[mainTag]) context.inMainTag = true;

                // Recolectar valores
                const values = {};
                if (context.inBrand && context.inMainTag && node[mainTag]) {
                    subtags.forEach(subtag => {
                        if (node[mainTag][subtag] !== undefined) {
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

    // Extraer metadatos del XML
    ipcMain.handle('data:extractMetadata', async (_, filePath) => {
        try {
            const xmlContent = fs.readFileSync(filePath, 'utf-8');
            
            const descMatch = xmlContent.match(/<Covol:DescripcionInstalacion>(.*?)<\/Covol:DescripcionInstalacion>/);
            const permisoMatch = xmlContent.match(/<Covol:NumPermiso>(.*?)<\/Covol:NumPermiso>/);
            const fechaMatch = xmlContent.match(/<Covol:FechaYHoraEstaMedicionMes>(.*?)<\/Covol:FechaYHoraEstaMedicionMes>/);

            return {
                descripcionInstalacion: descMatch?.[1]?.trim() || 'No especificado',
                numPermiso: permisoMatch?.[1]?.trim() || 'No especificado',
                fechaMedicion: fechaMatch?.[1]?.trim() || new Date().toLocaleDateString()
            };
        } catch (error) {
            console.error('Error al extraer metadatos:', error);
            throw error;
        }
    });

   // Reemplaza el handler 'report:generate' existente con este:
ipcMain.handle('dialog:saveFile', async (_, { content, defaultName, formatType }) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [
            { name: `${formatType.toUpperCase()} Files`, extensions: [formatType] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (canceled || !filePath) return null;

    try {
        fs.writeFileSync(filePath, content, 'utf-8');
        return filePath;
    } catch (error) {
        console.error('Error saving file:', error);
        throw error;
    }
});

// Mantén el handler 'report:generate' original para compatibilidad
ipcMain.handle('report:generate', async (_, { data, formatType }) => {
    try {
        const fileName = `Reporte_${data.brands.join('_')}_${new Date().toISOString().slice(0,10)}.${formatType}`;
        const filePath = await dialog.showSaveDialog({
            defaultPath: fileName,
            filters: [
                { name: 'PDF Files', extensions: ['pdf'] },
                { name: 'Text Files', extensions: ['txt'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (filePath.canceled || !filePath.filePath) return null;

        if (formatType === 'pdf') {
            await generatePDF(filePath.filePath, data);
        } else {
            await generateTXT(filePath.filePath, data);
        }

        return filePath.filePath;
    } catch (error) {
        console.error('Error al generar reporte:', error);
        throw error;
    }
});
}


// Función para generar PDF
async function generatePDF(filePath, data) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument();
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // Encabezado
        doc.fontSize(16)
           .font('Helvetica-Bold')
           .text('REPORTE DE DATOS', { align: 'center' });
        
        doc.moveDown();
        doc.fontSize(12)
           .font('Helvetica')
           .text(`Instalación: ${data.descripcionInstalacion}`)
           .text(`Permiso CRE: ${data.numPermiso}`)
           .text(`Fecha de generación: ${new Date().toLocaleString()}`);
        
        doc.moveDown(2);

        // Tabla de datos
        doc.fontSize(14).text('DATOS SELECCIONADOS:', { underline: true });
        doc.moveDown();

        // Crear tabla
        const startX = 50;
        let startY = doc.y;
        const rowHeight = 20;
        const colWidths = [100, 100, 150, 100];

        // Encabezados de tabla
        doc.font('Helvetica-Bold')
           .text('Marca', startX, startY)
           .text('Categoría', startX + colWidths[0], startY)
           .text('Dato', startX + colWidths[0] + colWidths[1], startY)
           .text('Valor', startX + colWidths[0] + colWidths[1] + colWidths[2], startY);
        
        startY += rowHeight;

        // Filas de datos
        doc.font('Helvetica');
        data.selectedTags.forEach(item => {
            doc.text(item.brand, startX, startY)
               .text(item.mainTag, startX + colWidths[0], startY)
               .text(item.key, startX + colWidths[0] + colWidths[1], startY)
               .text(item.value.toString(), startX + colWidths[0] + colWidths[1] + colWidths[2], startY);
            
            startY += rowHeight;
            
            // Nueva página si es necesario
            if (startY > doc.page.height - 50) {
                doc.addPage();
                startY = 50;
            }
        });

        doc.end();
        
        stream.on('finish', () => resolve(filePath));
        stream.on('error', reject);
    });
}

// Función para generar TXT
async function generateTXT(filePath, data) {
    let content = '============================================\n';
    content += '           REPORTE DE DATOS           \n';
    content += '============================================\n\n';
    
    // Encabezado
    content += `Instalación: ${data.descripcionInstalacion}\n`;
    content += `Permiso CRE: ${data.numPermiso}\n`;
    content += `Fecha de generación: ${new Date().toLocaleString()}\n\n`;
    
    content += 'DATOS SELECCIONADOS:\n';
    content += '--------------------------------------------\n';
    
    // Encabezados de tabla
    content += 'Marca'.padEnd(20) + 'Categoría'.padEnd(20) + 'Dato'.padEnd(30) + 'Valor\n';
    content += '--------------------------------------------\n';
    
    // Filas de datos
    data.selectedTags.forEach(item => {
        content += item.brand.padEnd(20) + 
                  item.mainTag.padEnd(20) + 
                  item.key.padEnd(30) + 
                  item.value.toString() + '\n';
    });
    
    content += '============================================\n';
    content += '                 FIN DEL REPORTE            \n';
    content += '============================================\n';
    
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
}

// Función para generar TXT
async function generateTXT(filePath, data) {
    // Encabezado del reporte
    let content = '===================================================\n';
    content += '           REPORTE DE RECEPCIONES PEMEX           \n';
    content += '===================================================\n\n';
    
    // Información de la instalación
    content += `INSTALACIÓN: ${data.descripcionInstalacion}\n`;
    content += `PERMISO CRE: ${data.numPermiso}\n`;
    content += `FECHA GENERACIÓN: ${new Date().toLocaleString('es-MX')}\n`;
    content += `MARCAS INCLUIDAS: ${data.brands.join(', ')}\n\n`;
    
    content += '---------------------------------------------------\n';
    content += '                   DATOS DETALLADOS                \n';
    content += '---------------------------------------------------\n\n';

    // Agrupar datos por marca primero para mejor organización
    const groupedByBrand = {};
    data.selectedTags.forEach(item => {
        if (!groupedByBrand[item.brand]) {
            groupedByBrand[item.brand] = {};
        }
        if (!groupedByBrand[item.brand][item.mainTag]) {
            groupedByBrand[item.brand][item.mainTag] = [];
        }
        groupedByBrand[item.brand][item.mainTag].push(item);
    });

    // Generar contenido organizado por marca y categoría
    for (const [brand, categoriesData] of Object.entries(groupedByBrand)) {
        content += `MARCA: ${brand}\n`;
        content += '---------------------------------------------------\n';
        
        for (const [category, items] of Object.entries(categoriesData)) {
            content += `Categoría: ${category}\n`;
            content += '----------------------------\n';
            
            // Calcular el ancho máximo para alinear los valores
            const maxKeyLength = Math.max(...items.map(item => item.key.length));
            
            items.forEach(item => {
                // Formatear cada línea con alineación
                const paddedKey = item.key.padEnd(maxKeyLength + 2, ' ');
                content += `  ${paddedKey}: ${item.value}\n`;
            });
            
            content += '\n';
        }
        
        content += '\n';
    }

    // Totales resumidos (opcional)
    content += '===================================================\n';
    content += '                   RESUMEN FINAL                   \n';
    content += '===================================================\n\n';
    
    // Agregar totales por marca
    for (const brand of data.brands) {
        const brandItems = data.selectedTags.filter(item => item.brand === brand);
        if (brandItems.length > 0) {
            content += `${brand} - Total registros: ${brandItems.length}\n`;
        }
    }
    
    // Pie del reporte
    content += '\n===================================================\n';
    content += '          FIN DEL REPORTE - PEMEX RECEPCIONES      \n';
    content += '===================================================\n';
    
    // Escribir el archivo
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
}

// Función para formatear tamaño de archivo
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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




