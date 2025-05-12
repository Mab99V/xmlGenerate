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

    ipcMain.handle('data:getValues', async (_, { filePath, brandName, mainTag, subtags }) => {
        try {
            console.log(`Iniciando búsqueda para: ${brandName} - ${mainTag} - ${subtags.join(', ')}`);
            
            const xmlContent = fs.readFileSync(filePath, 'utf-8');
            console.log('XML leído correctamente');
            
            const result = await parseStringPromise(xmlContent, {
                explicitArray: false,
                ignoreAttrs: true,
                tagNameProcessors: [name => name.replace(/^Covol:/, '')],
                trim: true
            });
            
            console.log('XML parseado correctamente');
    
            // Función para buscar valores incluyendo estructuras anidadas
            const findValues = (node) => {
                const values = {};
                let foundBrand = false;
    
                const walk = (currentNode) => {
                    if (!currentNode) return;
                    
                    // Verificar si encontramos la marca correcta
                    if (currentNode.MarcaComercial === brandName) {
                        foundBrand = true;
                    }
                    
                    // Si estamos en la marca correcta y encontramos la categoría principal
                    if (foundBrand && currentNode[mainTag]) {
                        const mainNode = currentNode[mainTag];
                        
                        subtags.forEach(subtag => {
                            // Buscar directamente en el nodo principal
                            if (mainNode[subtag] !== undefined && values[subtag] === undefined) {
                                values[subtag] = mainNode[subtag];
                                console.log(`Encontrado ${subtag} directo: ${values[subtag]}`);
                            }
                            
                            // Búsqueda especial para ValorNumerico en estructuras anidadas
                            if (subtag === 'ValorNumerico' && !values[subtag]) {
                                const nestedPaths = {
                                    'RECEPCIONES': ['SumaVolumenRecepcionMes.ValorNumerico'],
                                    'ENTREGAS': ['SumaVolumenEntregaMes.ValorNumerico'],
                                    'CONTROLDEEXISTENCIAS': ['ValorNumerico']
                                };
                                
                                const paths = nestedPaths[mainTag] || [];
                                for (const path of paths) {
                                    const value = path.split('.').reduce((obj, key) => obj?.[key], mainNode);
                                    if (value !== undefined) {
                                        values[subtag] = value;
                                        console.log(`Encontrado ${subtag} anidado: ${values[subtag]}`);
                                        break;
                                    }
                                }
                            }
                        });
                    }
                    
                    // Continuar búsqueda recursiva
                    for (const key in currentNode) {
                        if (typeof currentNode[key] === 'object') {
                            walk(currentNode[key]);
                        }
                    }
                };
                
                walk(node);
                return values;
            };
    
            const values = findValues(result);
            console.log('Valores encontrados:', values);
            
            // Asegurar que todas las subetiquetas solicitadas estén en la respuesta
            const completeValues = {};
            subtags.forEach(subtag => {
                completeValues[subtag] = values[subtag] !== undefined ? values[subtag] : null;
            });
    
            return completeValues;
            
        } catch (error) {
            console.error('Error en data:getValues:', error);
            throw new Error(`Error al obtener valores: ${error.message}`);
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
        const { filePath } = await dialog.showSaveDialog({
            defaultPath: fileName,
            filters: [
                { name: `${formatType.toUpperCase()} Files`, extensions: [formatType] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (!filePath) return null;

        if (formatType === 'pdf') {
            await generatePDF(filePath, data);
        } else {
            await generateTXT(filePath, data);
        }

        return filePath;
    } catch (error) {
        console.error('Error al generar reporte:', error);
        throw error;
    }
});

}
async function generatePDF(filePath, data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument();
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // Encabezado
            doc.fontSize(16)
               .font('Helvetica-Bold')
               .text('REPORTE DE COMBUSTIBLES', { align: 'center' })
               .moveDown(0.5);
            
            doc.fontSize(10)
               .font('Helvetica')
               .text(`Instalación: ${data.descripcionInstalacion}`, { align: 'left' })
               .text(`Permiso CRE: ${data.numPermiso}`, { align: 'left' })
               .text(`Fecha: ${new Date().toLocaleString('es-MX')}`, { align: 'left' })
               .text(`Marcas: ${data.brands.join(', ')}`, { align: 'left' })
               .moveDown(1);

            // Línea divisoria
            doc.moveTo(50, doc.y)
               .lineTo(550, doc.y)
               .stroke();
            
            doc.moveDown(0.5);
            doc.fontSize(12)
               .text('DETALLES:', { align: 'left' })
               .moveDown(0.5);

            // Configuración de columnas
            const col1 = 50;
            const col2 = 200;
            const col3 = 350;
            let y = doc.y;

            // Agrupar datos por marca
            const groupedByBrand = {};
            data.selectedTags.forEach(item => {
                if (!groupedByBrand[item.brand]) {
                    groupedByBrand[item.brand] = [];
                }
                groupedByBrand[item.brand].push(item);
            });

            // Orden de los campos
            const fieldOrder = {
                'RECEPCIONES': [
                    'TotalRecepcionesMes',
                    'ValorNumerico',
                    'TotalDocumentosMes',
                    'ImporteTotalRecepcionesMensual'
                ],
                'ENTREGAS': [
                    'TotalEntregasMes',
                    'ValorNumerico',
                    'TotalDocumentosMes',
                    'ImporteTotalEntregasMes'
                ],
                'CONTROLDEEXISTENCIAS': [
                    'ValorNumerico'
                ]
            };

            const category = data.selectedTags[0]?.mainTag || 'RECEPCIONES';
            const fields = fieldOrder[category] || [];

            // Generar contenido
            Object.keys(groupedByBrand).forEach(brand => {
                fields.forEach(field => {
                    const item = groupedByBrand[brand].find(i => i.key === field);
                    if (item) {
                        doc.text(`[${brand}]`, col1, y)
                           .text(category, col2, y)
                           .text(`${field}:`, col3, y)
                           .text(item.value.toString(), col3 + 150, y);
                        y += 20;
                    }
                });
                y += 10;
            });

            // Pie de página
            doc.moveDown(2);
            doc.fontSize(10)
               .text('Documento generado automáticamente - PEMEX', { align: 'center' });

            doc.end();
            
            stream.on('finish', () => resolve(filePath));
            stream.on('error', (err) => {
                console.error('Error al generar PDF:', err);
                reject(err);
            });
        } catch (error) {
            console.error('Error en generatePDF:', error);
            reject(error);
        }
    });
}

// Función para generar TXT
async function generateTXT(filePath, data) {
    // Validación de datos
    if (!data?.selectedTags?.length) {
        throw new Error('No hay datos seleccionados para generar el reporte');
    }

    // Encabezado del reporte
    let content = '============================================\n';
    content += 'REPORTE DE COMBUSTIBLES\n';
    content += '============================================\n';
    content += `Instalación: ${data.descripcionInstalacion}\n`;
    content += `Permiso CRE: ${data.numPermiso}\n`;
    content += `Fecha: ${new Date().toLocaleString('es-MX', {
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    })}\n`;
    content += `Marcas: ${data.brands.join(', ')}\n`;
    content += '--------------------------------------------\n';
    content += 'DETALLES:\n';

    // Agrupar datos por marca
    const groupedByBrand = {};
    data.selectedTags.forEach(item => {
        if (!groupedByBrand[item.brand]) {
            groupedByBrand[item.brand] = [];
        }
        groupedByBrand[item.brand].push(item);
    });

    // Generar contenido en el formato exacto requerido
    Object.keys(groupedByBrand).forEach(brand => {
        groupedByBrand[brand].forEach(item => {
            // Formato: [MARCA] CATEGORIA - TIPODATO: VALOR
            content += `[${brand}] ${item.mainTag} - ${item.key}: ${item.value}\n`;
        });
    });

    // Pie del reporte
    content += '============================================\n';

    // Escribir archivo
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




