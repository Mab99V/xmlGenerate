const { contextBridge, ipcRenderer } = require('electron');

// Función para escapar contenido y prevenir XSS
const sanitizeContent = (content) => {
    if (content === null || content === undefined) return '';
    return String(content)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// Función para formatear contenido del reporte TXT
const formatTXTContent = (data) => {
    // Validación estricta de datos
    if (!data.selectedTags || !Array.isArray(data.selectedTags)) {
        throw new Error('Datos de tags seleccionados no válidos');
    }
    if (!data.descripcionInstalacion || !data.numPermiso) {
        throw new Error('Faltan metadatos requeridos para el reporte');
    }

    const now = new Date();
    const formatDate = () => now.toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });

    // Orden preferido de campos para cada categoría
    const FIELD_ORDER = {
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

    // Agrupar datos por marca y categoría
    const groupedData = {};
    data.selectedTags.forEach(tag => {
        const brand = tag.brand || 'DESCONOCIDO';
        const category = tag.mainTag || 'RECEPCIONES';
        
        if (!groupedData[brand]) {
            groupedData[brand] = {};
        }
        if (!groupedData[brand][category]) {
            groupedData[brand][category] = [];
        }
        
        groupedData[brand][category].push({
            fieldName: tag.key || tag.subtag,
            value: tag.value
        });
    });

    // Generar contenido
    let content = '============================================\n';
    content += 'REPORTE DE COMBUSTIBLES\n';
    content += '============================================\n';
    content += `Instalación: ${sanitizeContent(data.descripcionInstalacion)}\n`;
    content += `Permiso CRE: ${sanitizeContent(data.numPermiso)}\n`;
    content += `Fecha: ${formatDate()}\n`;
    content += `Marcas: ${data.brands?.map(b => sanitizeContent(b)).join(', ') || 'No especificado'}\n`;
    content += '--------------------------------------------\n';
    content += 'DETALLES:\n';

    // Procesar cada marca en orden alfabético
    Object.keys(groupedData).sort().forEach(brand => {
        // Procesar cada categoría de la marca
        Object.keys(groupedData[brand]).forEach(category => {
            const fieldOrder = FIELD_ORDER[category] || [];
            const brandTags = groupedData[brand][category];
            
            // Mostrar campos en el orden específico
            fieldOrder.forEach(field => {
                const tag = brandTags.find(t => t.fieldName === field);
                if (tag) {
                    content += `[${sanitizeContent(brand)}] ${sanitizeContent(category)} - ${sanitizeContent(field)}: ${sanitizeContent(tag.value)}\n`;
                }
            });
        });
    });

    content += '============================================\n';
    return content;
};

// Función para formatear contenido del reporte PDF
const formatPDFContent = (data) => {
    const now = new Date();
    return {
        header: {
            title: 'REPORTE DE COMBUSTIBLES',
            installation: sanitizeContent(data.descripcionInstalacion),
            permit: sanitizeContent(data.numPermiso),
            date: now.toLocaleString('es-MX', {
                timeZone: 'America/Mexico_City',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }),
            brands: data.brands?.join(', ') || 'No especificado'
        },
        content: data.selectedTags.map(tag => ({
            brand: sanitizeContent(tag.brand),
            category: sanitizeContent(tag.mainTag || 'RECEPCIONES'),
            field: sanitizeContent(tag.key || tag.subtag),
            value: sanitizeContent(tag.value)
        }))
    };
};

// Función principal para formatear contenido
const formatReportContent = (data, formatType = 'txt') => {
    // Validación común
    if (!data || !data.selectedTags || !Array.isArray(data.selectedTags)) {
        throw new Error('Datos de reporte inválidos');
    }

    // Normalizar los datos seleccionados
    const normalizedTags = data.selectedTags.map(tag => ({
        brand: tag.brand || 'DESCONOCIDO',
        mainTag: tag.mainTag || 'RECEPCIONES',
        key: tag.key,
        subtag: tag.subtag,
        value: tag.value !== undefined ? tag.value : 'N/D'
    }));

    const reportData = {
        ...data,
        selectedTags: normalizedTags,
        brands: data.brands || [...new Set(normalizedTags.map(t => t.brand))]
    };

    return formatType === 'pdf' 
        ? formatPDFContent(reportData) 
        : formatTXTContent(reportData);
};

contextBridge.exposeInMainWorld('electronAPI', {
    // Operaciones con archivos
    openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
    saveFile: (content, fileName, formatType = 'txt') => {
        if (!content) throw new Error('El contenido del archivo es requerido');
        return ipcRenderer.invoke('dialog:saveFile', {
            content: formatType === 'pdf' ? JSON.stringify(content) : content,
            defaultName: fileName || `reporte_${new Date().toISOString().slice(0,10)}.${formatType}`,
            formatType
        });
    },

    // Extracción de datos
    extractBrands: (filePath) => {
        if (!filePath) throw new Error('La ruta del archivo es requerida');
        return ipcRenderer.invoke('data:extractBrands', filePath);
    },
    
    extractCategories: (filePath) => {
        if (!filePath) throw new Error('La ruta del archivo es requerida');
        return ipcRenderer.invoke('data:extractCategories', filePath);
    },
    
    getSubtagsByMainTag: (filePath, brandName, mainTag) => {
        if (!filePath || !mainTag) throw new Error('Parámetros requeridos faltantes');
        return ipcRenderer.invoke('data:getSubtags', { 
            filePath, 
            brandName: brandName || '', 
            mainTag 
        });
    },
    
    getSubtagValues: (filePath, brandName, mainTag, subtags) => {
        if (!filePath || !mainTag || !subtags?.length) {
            throw new Error('Parámetros requeridos faltantes');
        }
        return ipcRenderer.invoke('data:getValues', {
            filePath,
            brandName,
            mainTag,
            subtags: Array.isArray(subtags) ? subtags : [subtags]
        });
    },

    // Función unificada para generación de reportes
    generateReport: async (data, formatType = 'txt') => {
        try {
            console.log('[RENDERER] Preparando datos para generateReport', { formatType, data });

            // Validación mejorada y normalización de datos
            if (!data) throw new Error('Datos de reporte no proporcionados');
            
            // Normalización de selectedTags
            const normalizedSelectedTags = Array.isArray(data.selectedTags) 
                ? data.selectedTags 
                : (data.selectedTags ? [data.selectedTags] : []);

            // Validación detallada de estructura
            const validatedTags = normalizedSelectedTags.map((item, index) => {
                if (!item || typeof item !== 'object') {
                    throw new Error(`Item en posición ${index} no es un objeto válido`);
                }

                const requiredFields = ['brand', 'mainTag', 'key', 'value'];
                const missingFields = requiredFields.filter(field => !(field in item));

                if (missingFields.length > 0) {
                    throw new Error(`Item en posición ${index} falta campos: ${missingFields.join(', ')}`);
                }

                return {
                    brand: String(item.brand || 'Sin marca'),
                    mainTag: String(item.mainTag || 'Sin etiqueta principal'),
                    key: String(item.key || 'Sin clave'),
                    value: String(item.value || 'Sin valor')
                };
            });

            // Normalización de metadata
            const normalizedMetadata = data.metadata || {};
            const requiredMetadata = {
                descripcionInstalacion: normalizedMetadata.descripcionInstalacion || 'No especificado',
                numPermiso: normalizedMetadata.numPermiso || 'No especificado',
                fechaMedicion: normalizedMetadata.fechaMedicion || new Date().toISOString().slice(0,10)
            };

            // Preparar el objeto final normalizado
            const reportData = {
                selectedTags: validatedTags,
                brands: Array.isArray(data.brands) ? data.brands : [],
                metadata: requiredMetadata,
                timestamp: new Date().toISOString()
            };

            console.log('[RENDERER] Datos normalizados para reporte:', reportData);

            const fileName = `Reporte_Combustibles_${
                reportData.brands.join('_') || 'multiples'
            }_${new Date().toISOString().slice(0,10)}.${formatType}`;
            
            // Enviar al main process
            const result = await ipcRenderer.invoke('dialog:saveFile', {
                content: formatType === 'pdf' ? JSON.stringify(reportData) : formatReportContent(reportData, formatType),
                defaultName: fileName,
                formatType
            });

            console.log('[RENDERER] Resultado del guardado:', result);
            return result;

        } catch (error) {
            console.error('[RENDERER ERROR] Error en generateReport:', {
                error: error.message,
                stack: error.stack,
                inputData: data
            });
            throw error;
        }
    },
    // Eliminar generatePDFReport ya que está duplicada
    
    // Extracción de metadatos
    extractMetadata: (filePath) => {
        if (!filePath) throw new Error('La ruta del archivo es requerida');
        return ipcRenderer.invoke('data:extractMetadata', filePath);
    },

    // Utilidades
    formatContent: (data, formatType = 'txt') => {
        return formatReportContent(data, formatType);
    }
});

// Exponer función para mostrar notificaciones
contextBridge.exposeInMainWorld('notifications', {
    showNotification: (title, body) => {
        ipcRenderer.send('notification:show', { title, body });
    }
});