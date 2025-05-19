const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { parseStringPromise } = require('xml2js');
const PDFDocument = require('pdfkit');

let mainWindow;

// Función para obtener descripciones según la categoría
const getFieldDescriptions = (category) => {
    if (category === 'RECEPCIONES') {
        return {
            'TotalRecepcionesMes': 'Total de recepciones al mes',
            'ValorNumerico': 'Suma de volumen recibido al mes',
            'TotalDocumentosMes': 'Recepciones facturadas',
            'ImporteTotalRecepcionesMensual': 'Importe recepciones facturadas'
        };
    } else {
        return {
            'TotalEntregasMes': 'Total de entregas al mes',
            'ValorNumerico': 'Suma de volumen entregado al mes',
            'TotalDocumentosMes': 'Entregas Facturadas',
            'ImporteTotalEntregasMes': 'Importe de entregas facturadas'
        };
    }
};
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
            
            const categoryPattern = /<(?:Covol:)?(RECEPCIONES|ENTREGAS|CONTROLDEEXISTENCIAS)(?:>|\s)/g;
            const foundCategories = new Set();
            let match;
            
            while ((match = categoryPattern.exec(xmlContent)) !== null) {
                foundCategories.add(match[1]);
            }
            
            return Array.from(foundCategories).length > 0 
                ? Array.from(foundCategories) 
                : ['RECEPCIONES'];
                
        } catch (error) {
            console.error('Error al extraer categorías:', error);
            return ['RECEPCIONES'];
        }
    });
    
    // Extraer marcas comerciales del XML
    ipcMain.handle('data:extractBrands', async (_, filePath) => {
        try {
            const xmlContent = fs.readFileSync(filePath, 'utf-8');
            const result = await parseStringPromise(xmlContent, {
                explicitArray: false,
                ignoreAttrs: true,
                tagNameProcessors: [name => name.replace(/^Covol:/, '')],
                trim: true
            });
    
            const brands = new Set();
    
            function findBrands(node) {
                if (!node) return;
                
                if (node.MarcaComercial) {
                    const brand = typeof node.MarcaComercial === 'string' 
                        ? node.MarcaComercial 
                        : node.MarcaComercial._ || node.MarcaComercial['$']?.text;
                    if (brand && brand.trim()) {
                        brands.add(brand.trim());
                    }
                }
    
                for (const key in node) {
                    if (typeof node[key] === 'object') {
                        findBrands(node[key]);
                    }
                }
            }
    
            findBrands(result);
            return Array.from(brands).filter(b => b);
    
        } catch (error) {
            console.error('Error al extraer marcas:', error);
            throw new Error('Error al procesar el archivo XML: ' + error.message);
        }
    });

    // Extraer valores específicos del XML
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
    
            const findValues = (node) => {
                const values = {};
                let foundBrand = false;
            
                const walk = (currentNode) => {
                    if (!currentNode) return;
                    
                    if (currentNode.MarcaComercial === brandName) {
                        foundBrand = true;
                    }
                    
                    if (foundBrand && currentNode[mainTag]) {
                        const mainNode = currentNode[mainTag];
                        
                        subtags.forEach(subtag => {
                            if (mainNode[subtag] !== undefined && values[subtag] === undefined) {
                                values[subtag] = mainNode[subtag];
                                console.log(`Encontrado ${subtag} directo: ${values[subtag]}`);
                            }
                            
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
            const xmlContent = await fs.promises.readFile(filePath, 'utf-8');
            
            // Extraer NumPermiso con namespace
            const numPermisoMatch = xmlContent.match(/<Covol:NumPermiso>([^<]+)<\/Covol:NumPermiso>/);
            const numPermiso = numPermisoMatch ? numPermisoMatch[1].trim() : 'No especificado';
            
            // Extraer DescripcionInstalacion con namespace
            const descripcionMatch = xmlContent.match(/<Covol:DescripcionInstalacion>([^<]+)<\/Covol:DescripcionInstalacion>/);
            const descripcionInstalacion = descripcionMatch ? descripcionMatch[1].trim() : 'No especificado';
            
            // Extraer fecha
            const fechaMatch = xmlContent.match(/<Covol:FechaMedicion>([^<]+)<\/Covol:FechaMedicion>/);
            const fechaMedicion = fechaMatch ? fechaMatch[1].trim() : new Date().toLocaleString('es-MX');
            
            return {
                numPermiso,
                descripcionInstalacion,
                fechaMedicion
            };
        } catch (error) {
            console.error('Error al extraer metadatos:', error);
            return {
                numPermiso: 'No disponible',
                descripcionInstalacion: 'No disponible',
                fechaMedicion: new Date().toLocaleString('es-MX')
            };
        }
    });
    
    // Handler para guardar archivo PDF
    ipcMain.handle('dialog:saveFile', async (_, { content, defaultName, formatType }) => {
        try {
            console.log('[SAVE] Iniciando proceso de guardado', { formatType, defaultName });
            
            if (!content || !defaultName || !formatType) {
                throw new Error('Parámetros incompletos para guardar archivo');
            }

            if (formatType !== 'pdf') {
                throw new Error('Solo se admite generación de PDF');
            }

            console.log('[SAVE] Mostrando diálogo de guardado...');
            const { filePath, canceled } = await dialog.showSaveDialog({
                defaultPath: defaultName,
                filters: [
                    { name: 'PDF Files', extensions: ['pdf'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (canceled || !filePath) {
                console.log('[SAVE] Usuario canceló el diálogo');
                return { success: false, canceled: true };
            }

            console.log('[SAVE] Ruta seleccionada:', filePath);
            console.log('[SAVE] Procesando PDF...');
            
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

            if (!parsedContent.selectedTags || !Array.isArray(parsedContent.selectedTags)) {
                throw new Error('Formato de datos inválido: selectedTags debe ser un array');
            }

            if (parsedContent.selectedTags.length === 0) {
                throw new Error('No hay datos seleccionados para generar el PDF');
            }

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

    // Handler específico para PDF
    ipcMain.handle('report:generatePDF', async (_, { content, fileName }) => {
        try {
            const { filePath } = await dialog.showSaveDialog({
                defaultPath: fileName,
                filters: [
                    { name: 'PDF Files', extensions: ['pdf'] }
                ]
            });

            if (!filePath) return { canceled: true };

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

// Función para generar PDF
async function generatePDF(filePath, data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

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
               .text(`Instalación: ${data.metadata?.descripcionInstalacion || 'No especificado'}`, { align: 'left' })
               .text(`Permiso CRE: ${data.metadata?.numPermiso || 'No especificado'}`, { align: 'left' })
               .text(`Fecha: ${data.metadata?.fechaMedicion || new Date().toLocaleString('es-MX')}`, { align: 'left' })
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
            const col2 = 250;
            const col3 = 450;
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
                    // Obtener descripciones dinámicas
                    const fieldDescriptions = getFieldDescriptions(category);
                    
                    // Mostrar categoría como subtítulo
                    doc.fontSize(11)
                       .font('Helvetica-Bold')
                       .text(`${brand} - ${category}`, col1, y);
                    y += 20;
                    
                    // Mostrar datos con descripciones completas
                    doc.fontSize(10)
                       .font('Helvetica');
                       
                    groupedData[brand][category].forEach(item => {
                        const fieldName = item.key;
                        const description = fieldDescriptions[fieldName] || fieldName;
                        let displayValue = item.value?.toString() || 'N/D';
                        
                        // Formatear valores especiales
                        if (fieldName === 'ValorNumerico') {
                            displayValue += ' LITROS';
                        } else if (fieldName.includes('Importe')) {
                            displayValue = '$' + displayValue;
                        }
                        
                        doc.text(fieldName, col1 + 20, y)
                           .text(description, col2, y)
                           .text(displayValue, col3, y, { width: 100, align: 'right' });
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