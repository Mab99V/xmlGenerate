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

    generateReport: async (data, formatType = 'txt') => {
        try {
            console.log('[RENDERER] Iniciando generación de reporte', { formatType });

            // Validación básica de entrada
            if (!data) throw new Error('Datos no proporcionados');

            // Normalización de metadatos con valores por defecto
            const requiredMetadata = {
                descripcionInstalacion: data.metadata?.descripcionInstalacion || 'No especificado',
                numPermiso: data.metadata?.numPermiso || 'No especificado',
                fechaMedicion: data.metadata?.fechaMedicion || new Date().toISOString().slice(0,10)
            };

            // Verificación de metadatos mínimos (puedes ajustar según tus necesidades)
            if (!data.metadata) {
                console.warn('[RENDERER] Advertencia: No se proporcionaron metadatos, usando valores por defecto');
            }

            // Normalización de selectedTags
            const normalizedTags = Array.isArray(data.selectedTags) 
                ? data.selectedTags 
                : (data.selectedTags ? [data.selectedTags] : []);

            if (normalizedTags.length === 0) {
                throw new Error('No hay datos seleccionados para generar el reporte');
            }

            // Estructura final normalizada
            const normalizedData = {
                selectedTags: normalizedTags.map(tag => ({
                    brand: String(tag.brand || 'Sin marca'),
                    mainTag: String(tag.mainTag || 'Sin categoría'),
                    key: String(tag.key || 'Sin clave'),
                    value: String(tag.value || 'Sin valor')
                })),
                brands: Array.isArray(data.brands) ? data.brands : [],
                metadata: requiredMetadata
            };

            console.log('[RENDERER] Datos normalizados:', normalizedData);

            // Generación de contenido según formato
            let contentToSave;
            const fileName = `Reporte_${normalizedData.brands.join('_') || 'multiples'}_${new Date().toISOString().slice(0,10)}.${formatType}`;

            if (formatType === 'pdf') {
                contentToSave = JSON.stringify(normalizedData);
            } else {
                contentToSave = this.generateTextContent(normalizedData);
            }

            return await ipcRenderer.invoke('dialog:saveFile', {
                content: contentToSave,
                defaultName: fileName,
                formatType
            });

        } catch (error) {
            console.error('[RENDERER ERROR] Detalles completos:', {
                error: error.message,
                stack: error.stack,
                inputData: data
            });
            throw error;
        }
    },

    generateTextContent: (data) => {
        try {
            // Encabezado con metadatos
            let content = `=== REPORTE DE COMBUSTIBLES ===\n\n`;
            content += `Instalación: ${data.metadata.descripcionInstalacion}\n`;
            content += `Número de Permiso: ${data.metadata.numPermiso}\n`;
            content += `Fecha de Medición: ${data.metadata.fechaMedicion}\n\n`;
            
            // Datos principales
            content += `=== DATOS ===\n`;
            data.selectedTags.forEach((item, index) => {
                content += `\nRegistro ${index + 1}:\n`;
                content += `Marca: ${item.brand}\n`;
                content += `Categoría: ${item.mainTag}\n`;
                content += `Clave: ${item.key}\n`;
                content += `Valor: ${item.value}\n`;
            });
            
            // Pie de reporte
            content += `\n=== FIN DEL REPORTE ===\n`;
            content += `Generado el: ${new Date().toLocaleString()}\n`;
            
            return content;
        } catch (error) {
            console.error('[RENDERER ERROR] Error al generar texto:', error);
            throw new Error('Error al formatear el contenido de texto');
        }
    },

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