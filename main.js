const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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

    // Extraer categorías del XML
    ipcMain.handle('data:extractCategories', async (_, filePath) => {
        try {
            const xmlContent = fs.readFileSync(filePath, 'utf-8');
            
            // Buscar todas las categorías posibles en el XML
            const categoryPattern = /<(?:Covol:)?(RECEPCIONES|ENTREGAS|CONTROLDEEXISTENCIAS)(?:>|\s)/g;
            const foundCategories = new Set();
            let match;
            
            while ((match = categoryPattern.exec(xmlContent)) !== null) {
                foundCategories.add(match[1]);
            }
            
            // Si no encontramos ninguna categoría, usar RECEPCIONES como valor por defecto
            return Array.from(foundCategories).length > 0 
                ? Array.from(foundCategories) 
                : ['RECEPCIONES'];
                
        } catch (error) {
            console.error('Error al extraer categorías:', error);
            return ['RECEPCIONES']; // Valor por defecto si hay error
        }
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
                                    'RECEPCIONES': ['SumaVolumenRecepcionMes.ValorNumerico', 'ValorNumerico'],
                                    'ENTREGAS': ['SumaVolumenEntregadoMes.ValorNumerico', 'ValorNumerico'],
                                    'CONTROLDEEXISTENCIAS': ['VolumenExistenciasMes.ValorNumerico', 'ValorNumerico']
                                };
                                
                                const paths = nestedPaths[mainTag] || [];
                                for (const path of paths) {
                                    const value = path.split('.').reduce((obj, key) => {
                                        if (obj && typeof obj === 'object') {
                                            return obj[key];
                                        }
                                        return undefined;
                                    }, mainNode);
                                    
                                    if (value !== undefined && value !== null) {
                                        values[subtag] = value;
                                        console.log(`Encontrado ${subtag} anidado (${path}): ${values[subtag]}`);
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

   // Handler para guardar archivo con validación completa
ipcMain.handle('dialog:saveFile', async (_, { content, defaultName, formatType }) => {
    try {
        console.log('[SAVE] Iniciando proceso de guardado', { formatType, defaultName });
        
        // Validación básica de parámetros
        if (!content || !defaultName || !formatType) {
            throw new Error('Parámetros incompletos para guardar archivo');
        }

        // Mostrar diálogo de guardado
        console.log('[SAVE] Mostrando diálogo de guardado...');
        const { filePath, canceled } = await dialog.showSaveDialog({
            defaultPath: defaultName,
            filters: [
                { name: `${formatType.toUpperCase()} Files`, extensions: [formatType] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (canceled || !filePath) {
            console.log('[SAVE] Usuario canceló el diálogo');
            return { success: false, canceled: true };
        }

        console.log('[SAVE] Ruta seleccionada:', filePath);

        // Procesamiento según tipo de archivo
        if (formatType === 'pdf') {
            console.log('[SAVE] Procesando PDF...');
            
            // Validar y parsear contenido
            let parsedContent;
            try {
                parsedContent = JSON.parse(content);
                console.log('[SAVE] Contenido PDF parseado:', {
                    selectedTags: parsedContent.selectedTags?.length || 0,
                    brands: parsedContent.brands?.length || 0
                });
            } catch (parseError) {
                throw new Error('El contenido PDF no es un JSON válido');
            }

            // Validar estructura de datos
            if (!parsedContent.selectedTags || !Array.isArray(parsedContent.selectedTags)) {
                throw new Error('Formato de datos inválido: selectedTags debe ser un array');
            }

            if (parsedContent.selectedTags.length === 0) {
                throw new Error('No hay datos seleccionados para generar el PDF');
            }

            // Generar PDF
            console.log('[SAVE] Generando PDF...');
            await generatePDF(filePath, parsedContent);
            
            console.log('[SAVE] PDF generado exitosamente');
            return { 
                success: true, 
                path: filePath,
                stats: {
                    tagsCount: parsedContent.selectedTags.length,
                    brandsCount: parsedContent.brands?.length || 0
                }
            };

        } else if (formatType === 'txt') {
            console.log('[SAVE] Guardando TXT...');
            
            // Validar contenido TXT
            if (typeof content !== 'string') {
                throw new Error('El contenido para TXT debe ser un string');
            }

            if (content.length === 0) {
                throw new Error('El contenido TXT está vacío');
            }

            fs.writeFileSync(filePath, content, 'utf-8');
            console.log('[SAVE] TXT guardado exitosamente');
            return { 
                success: true, 
                path: filePath,
                stats: {
                    size: content.length
                }
            };

        } else {
            throw new Error(`Tipo de archivo no soportado: ${formatType}`);
        }

    } catch (error) {
        console.error('[SAVE ERROR] Detalles del error:', {
            message: error.message,
            stack: error.stack,
            inputParams: {
                formatType,
                defaultName,
                contentLength: content?.length || 0
            }
        });
        throw error;
    }
});

    // Handler para generar reporte (compatibilidad)
    ipcMain.handle('report:generate', async (_, { data, formatType }) => {
        try {
            const fileName = `Reporte_Combustibles_${data.brands.join('_')}_${new Date().toISOString().slice(0,10)}.${formatType}`;
            
            const { filePath } = await dialog.showSaveDialog({
                defaultPath: fileName,
                filters: [
                    { name: 'PDF Files', extensions: ['pdf'] },
                    { name: 'Text Files', extensions: ['txt'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (!filePath) return null;

            if (formatType === 'pdf') {
                await generatePDF(filePath, data);
                // Abrir el PDF con el visor predeterminado
                shell.openPath(filePath).catch(err => {
                    console.error('Error al abrir PDF:', err);
                });
                return { success: true, path: filePath };
            } else if (formatType === 'txt') {
                await generateTXT(filePath, data);
                return { success: true, path: filePath };
            }
            
            return { success: false, message: 'Formato no soportado' };
        } catch (error) {
            console.error('Error al generar reporte:', error);
            throw error;
        }
    });

    // Handler específico para PDF
    ipcMain.handle('report:generatePDF', async (_, { content, filePath }) => {
        try {
            await generatePDF(filePath, content);
            shell.openPath(filePath).catch(err => {
                console.error('Error al abrir PDF:', err);
            });
            return { success: true, path: filePath };
        } catch (error) {
            console.error('Error al generar PDF:', error);
            throw error;
        }
    });
}

// Función mejorada para generar PDF
async function generatePDF(filePath, data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // Validar datos primero
            if (!data?.selectedTags?.length) {
                throw new Error('No hay datos seleccionados para generar el reporte');
            }

            // Encabezado
            doc.fontSize(16)
               .font('Helvetica-Bold')
               .text('REPORTE DE COMBUSTIBLES', { align: 'center' })
               .moveDown(0.5);
            
            // Metadatos
            doc.fontSize(10)
               .font('Helvetica')
               .text(`Instalación: ${data.descripcionInstalacion || 'No especificado'}`, { align: 'left' })
               .text(`Permiso CRE: ${data.numPermiso || 'No especificado'}`, { align: 'left' })
               .text(`Fecha: ${new Date().toLocaleString('es-MX')}`, { align: 'left' })
               .text(`Marcas: ${data.brands?.join(', ') || 'No especificado'}`, { align: 'left' })
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
            const col3 = 350;
            let y = doc.y;

            // Agrupar datos por marca y categoría
            const groupedData = {};
            data.selectedTags.forEach(item => {
                if (!groupedData[item.brand]) {
                    groupedData[item.brand] = {};
                }
                if (!groupedData[item.brand][item.mainTag]) {
                    groupedData[item.brand][item.mainTag] = [];
                }
                groupedData[item.brand][item.mainTag].push(item);
            });

            // Generar contenido
            Object.keys(groupedData).sort().forEach(brand => {
                Object.keys(groupedData[brand]).sort().forEach(category => {
                    // Mostrar categoría como subtítulo
                    doc.fontSize(11)
                       .font('Helvetica-Bold')
                       .text(`${brand} - ${category}`, col1, y);
                    y += 20;
                    
                    // Mostrar datos
                    doc.fontSize(10)
                       .font('Helvetica');
                       
                    groupedData[brand][category].forEach(item => {
                        const fieldName = item.key || item.subtag;
                        doc.text(fieldName, col1 + 20, y)
                           .text(item.value?.toString() || 'N/D', col3, y);
                        y += 15;
                        
                        // Manejar saltos de página
                        if (y > 700) {
                            doc.addPage();
                            y = 50;
                        }
                    });
                    
                    y += 10; // Espacio entre categorías
                });
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

// Función mejorada para generar TXT
async function generateTXT(filePath, data) {
    try {
        // Validación de datos
        if (!data?.selectedTags?.length) {
            throw new Error('No hay datos seleccionados para generar el reporte');
        }

        // Encabezado del reporte
        let content = '============================================\n';
        content += 'REPORTE DE COMBUSTIBLES\n';
        content += '============================================\n';
        content += `Instalación: ${data.descripcionInstalacion || 'No especificado'}\n`;
        content += `Permiso CRE: ${data.numPermiso || 'No especificado'}\n`;
        content += `Fecha: ${new Date().toLocaleString('es-MX', {
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })}\n`;
        content += `Marcas: ${data.brands?.join(', ') || 'No especificado'}\n`;
        content += '--------------------------------------------\n';
        content += 'DETALLES:\n';

        // Agrupar datos por marca y categoría
        const groupedData = {};
        data.selectedTags.forEach(item => {
            if (!groupedData[item.brand]) {
                groupedData[item.brand] = {};
            }
            if (!groupedData[item.brand][item.mainTag]) {
                groupedData[item.brand][item.mainTag] = [];
            }
            groupedData[item.brand][item.mainTag].push(item);
        });

        // Generar contenido en el formato exacto requerido
        Object.keys(groupedData).sort().forEach(brand => {
            Object.keys(groupedData[brand]).sort().forEach(category => {
                groupedData[brand][category].forEach(item => {
                    // Formato: [MARCA] CATEGORIA - TIPODATO: VALOR
                    const fieldName = item.key || item.subtag;
                    content += `[${brand}] ${category} - ${fieldName}: ${item.value}\n`;
                });
            });
        });

        // Pie del reporte
        content += '============================================\n';

        // Escribir archivo
        fs.writeFileSync(filePath, content, 'utf-8');
        return filePath;
    } catch (error) {
        console.error('Error en generateTXT:', error);
        throw error;
    }
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