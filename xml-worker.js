const fs = require('fs');
const { parseStringPromise, Builder } = require('xml2js');
const path = require('path');

// Configuración optimizada del parser XML
const parserOptions = {
    explicitArray: false,
    ignoreAttrs: true,
    tagNameProcessors: [name => name.replace(/^Covol:/, '')],
    trim: true,
    mergeAttrs: true,
    explicitRoot: false
};

// Cache para almacenar archivos XML ya parseados
const fileCache = new Map();

/**
 * Extrae todas las marcas comerciales únicas del archivo XML
 * @param {string} filePath - Ruta del archivo XML
 * @returns {Promise<string[]>} - Array de marcas comerciales
 */
async function extractBrands(filePath) {
    try {
        // Verificar si ya tenemos el archivo en cache
        if (fileCache.has(filePath)) {
            const cached = fileCache.get(filePath);
            return Array.from(new Set(cached.brands));
        }

        const xmlData = await fs.promises.readFile(filePath, 'utf-8');
        const result = await parseStringPromise(xmlData, parserOptions);
        
        // Almacenar en cache
        const brands = findBrands(result);
        fileCache.set(filePath, { result, brands });
        
        return brands;
    } catch (error) {
        console.error('Error en extractBrands:', error);
        throw new Error(`Error al extraer marcas: ${error.message}`);
    }
}

// Función recursiva para encontrar marcas
function findBrands(node, brands = new Set()) {
    if (!node) return Array.from(brands);

    if (node.MarcaComercial) {
        const brand = typeof node.MarcaComercial === 'string' 
            ? node.MarcaComercial 
            : (node.MarcaComercial._ || node.MarcaComercial['$']?.text || '');
        if (brand.trim()) brands.add(brand.trim());
    }

    for (const key in node) {
        if (typeof node[key] === 'object') {
            findBrands(node[key], brands);
        }
    }

    return Array.from(brands).filter(b => b);
}

/**
 * Obtiene las subetiquetas disponibles para una categoría principal
 * @param {string} filePath - Ruta del archivo XML
 * @param {string} brandName - Nombre de la marca comercial
 * @param {string} mainTag - Categoría principal (RECEPCIONES, ENTREGAS, etc.)
 * @returns {Promise<string[]>} - Array de subetiquetas disponibles
 */
async function getSubtagsByMainTag(filePath, brandName, mainTag) {
    try {
        // Mapeo completo de categorías y sus subetiquetas
        const fullTagStructure = {
            'RECEPCIONES': [
                'TotalRecepcionesMes',
                'ValorNumerico',
                'TotalDocumentosMes',
                'ImporteTotalRecepciones',
                'FechaYHoraEstaMedicionMes',
                'Producto',
                'UnidadMedida'
            ],
            'ENTREGAS': [
                'TotalEntregasMes',
                'ValorNumerico',
                'TotalDocumentosMes',
                'ImporteTotalEntregasMes',
                'FechaYHoraEstaMedicionMes',
                'Producto',
                'UnidadMedida'
            ],
            'CONTROLDEEXISTENCIAS': [
                'ValorNumerico',
                'FechaYHoraEstaMedicionMes',
                'ExistenciaInicial',
                'ExistenciaFinal',
                'Producto',
                'UnidadMedida'
            ]
        };

        if (!fullTagStructure[mainTag]) {
            throw new Error(`Categoría principal '${mainTag}' no soportada`);
        }

        // Obtener datos del XML (usando cache si está disponible)
        const xmlData = fileCache.has(filePath) 
            ? fileCache.get(filePath).result 
            : await parseXmlFile(filePath);

        const availableSubtags = new Set();

        // Buscar subetiquetas en el contexto de la marca y categoría
        findSubtags(xmlData, brandName, mainTag, fullTagStructure[mainTag], availableSubtags);

        // Devolver en el orden definido, solo las existentes
        return fullTagStructure[mainTag].filter(tag => availableSubtags.has(tag));

    } catch (error) {
        console.error('Error en getSubtagsByMainTag:', error);
        throw new Error(`Error obteniendo subetiquetas: ${error.message}`);
    }
}

// Función auxiliar para parsear XML
async function parseXmlFile(filePath) {
    const xmlData = await fs.promises.readFile(filePath, 'utf-8');
    const result = await parseStringPromise(xmlData, parserOptions);
    fileCache.set(filePath, { result, brands: findBrands(result) });
    return result;
}

// Función recursiva para encontrar subetiquetas
function findSubtags(node, brandName, mainTag, possibleSubtags, foundSubtags, inBrandContext = false) {
    if (!node || foundSubtags.size === possibleSubtags.length) return;

    // Verificar si estamos en el contexto de la marca correcta
    if (node.MarcaComercial) {
        const currentBrand = getNodeValue(node.MarcaComercial);
        inBrandContext = (currentBrand === brandName);
    }

    // Buscar en la categoría principal
    if (inBrandContext && node[mainTag]) {
        const mainNode = node[mainTag];
        possibleSubtags.forEach(subtag => {
            if (mainNode[subtag] && !foundSubtags.has(subtag)) {
                foundSubtags.add(subtag);
            }
        });
    }

    // Búsqueda recursiva
    for (const key in node) {
        if (typeof node[key] === 'object') {
            findSubtags(node[key], brandName, mainTag, possibleSubtags, foundSubtags, inBrandContext);
        }
    }
}

/**
 * Obtiene los valores de las subetiquetas especificadas
 * @param {string} filePath - Ruta del archivo XML
 * @param {string} brandName - Nombre de la marca comercial
 * @param {string} mainTag - Categoría principal
 * @param {string[]} subtags - Subetiquetas a buscar
 * @returns {Promise<Object>} - Objeto con los valores encontrados
 */
async function getSubtagValues(filePath, brandName, mainTag, subtags) {
    try {
        if (!subtags || subtags.length === 0) {
            throw new Error('Debe especificar al menos una subetiqueta');
        }

        // Obtener datos del XML (usando cache si está disponible)
        const xmlData = fileCache.has(filePath) 
            ? fileCache.get(filePath).result 
            : await parseXmlFile(filePath);

        const values = {};
        const remainingTags = new Set(subtags);

        // Buscar valores recursivamente
        findValues(xmlData, brandName, mainTag, remainingTags, values);

        // Verificar que se encontraron todos los valores
        const missingTags = subtags.filter(tag => !values[tag]);
        if (missingTags.length > 0) {
            console.warn(`No se encontraron valores para: ${missingTags.join(', ')}`);
        }

        return values;

    } catch (error) {
        console.error('Error en getSubtagValues:', error);
        throw new Error(`Error obteniendo valores: ${error.message}`);
    }
}

// Función recursiva para encontrar valores
function findValues(node, brandName, mainTag, remainingTags, foundValues, inBrandContext = false) {
    if (!node || remainingTags.size === 0) return;

    // Verificar contexto de marca
    if (node.MarcaComercial) {
        const currentBrand = getNodeValue(node.MarcaComercial);
        inBrandContext = (currentBrand === brandName);
    }

    // Buscar valores en la categoría principal
    if (inBrandContext && node[mainTag]) {
        const mainNode = node[mainTag];
        remainingTags.forEach(tag => {
            if (mainNode[tag] && !foundValues[tag]) {
                foundValues[tag] = getNodeValue(mainNode[tag]);
                remainingTags.delete(tag);
            }
        });
    }

    // Búsqueda recursiva
    for (const key in node) {
        if (typeof node[key] === 'object') {
            findValues(node[key], brandName, mainTag, remainingTags, foundValues, inBrandContext);
        }
    }
}

// Función auxiliar para obtener valores de nodos XML
function getNodeValue(node) {
    if (typeof node === 'string') return node;
    if (node._) return node._;
    if (node['$']?.text) return node['$'].text;
    if (typeof node === 'object') return JSON.stringify(node);
    return '';
}

/**
 * Genera un archivo XML con los datos seleccionados
 * @param {Array} selectedData - Datos seleccionados para el reporte
 * @param {string} outputPath - Ruta de salida para el archivo
 * @returns {Promise<string>} - Ruta del archivo generado
 */
async function generateXMLReport(selectedData, outputPath) {
    try {
        if (!selectedData || !Array.isArray(selectedData)) {
            throw new Error('Datos de entrada no válidos');
        }

        const reportData = {
            Reporte: {
                Encabezado: {
                    FechaGeneracion: new Date().toISOString(),
                    Version: '1.0'
                },
                Datos: selectedData.map(item => ({
                    Marca: item.brand,
                    Categoria: item.mainTag,
                    Subcategoria: item.subtags.map(subtag => ({
                        Nombre: subtag.name,
                        Valor: subtag.value,
                        Unidad: subtag.unit || 'N/A'
                    }))
                }))
            }
        };

        const builder = new Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8' },
            renderOpts: { pretty: true, indent: '  ', newline: '\n' }
        });

        const xml = builder.buildObject(reportData);
        await fs.promises.writeFile(outputPath, xml, 'utf-8');
        return outputPath;

    } catch (error) {
        console.error('Error en generateXMLReport:', error);
        throw new Error(`Error generando reporte XML: ${error.message}`);
    }
}

/**
 * Extrae metadatos importantes del archivo XML
 * @param {string} filePath - Ruta del archivo XML
 * @returns {Promise<Object>} - Objeto con metadatos
 */
async function extractMetadata(filePath) {
    try {
        const xmlData = fileCache.has(filePath) 
            ? fileCache.get(filePath).result 
            : await parseXmlFile(filePath);

        const findMetadata = (node, metadata = {}) => {
            if (!node) return metadata;

            if (node.DescripcionInstalacion) {
                metadata.descripcionInstalacion = getNodeValue(node.DescripcionInstalacion);
            }
            if (node.NumPermiso) {
                metadata.numPermiso = getNodeValue(node.NumPermiso);
            }
            if (node.FechaYHoraEstaMedicionMes) {
                metadata.fechaMedicion = getNodeValue(node.FechaYHoraEstaMedicionMes);
            }

            for (const key in node) {
                if (typeof node[key] === 'object') {
                    findMetadata(node[key], metadata);
                }
            }

            return metadata;
        };

        return findMetadata(xmlData);

    } catch (error) {
        console.error('Error en extractMetadata:', error);
        throw new Error(`Error extrayendo metadatos: ${error.message}`);
    }
}

module.exports = {
    extractBrands,
    getSubtagsByMainTag,
    getSubtagValues,
    generateXMLReport,
    extractMetadata,
    // Exportar para testing
    _private: {
        findBrands,
        findSubtags,
        findValues,
        getNodeValue
    }
};