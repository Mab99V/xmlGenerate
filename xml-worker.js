const fs = require('fs');
const xml2js = require('xml2js');

// Configuración común del parser
const parserOptions = {
    explicitArray: false,
    xmlns: true,
    ignoreAttrs: true,
    explicitCharkey: true,
    preserveChildrenOrder: true,
    tagNameProcessors: [xml2js.processors.stripPrefix]
};

// Función para extraer marcas comerciales
async function extractBrands(filePath) {
    try {
        const xmlData = fs.readFileSync(filePath, 'utf-8');
        const parser = new xml2js.Parser(parserOptions);
        const result = await parser.parseStringPromise(xmlData);
        const brands = new Set();

        const findBrands = (node) => {
            if (!node) return;

            if (node.MarcaComercial) {
                const brand = typeof node.MarcaComercial === 'string' 
                    ? node.MarcaComercial 
                    : (node.MarcaComercial._ || '');
                if (brand.trim() !== '') {
                    brands.add(brand.trim());
                }
            }

            Object.values(node).forEach(child => {
                if (typeof child === 'object') {
                    findBrands(child);
                }
            });
        };

        findBrands(result);
        return Array.from(brands).filter(b => b);

    } catch (error) {
        console.error('Error en extractBrands:', error);
        throw new Error(`Error procesando XML: ${error.message}`);
    }
}

// Función para obtener las subetiquetas según la etiqueta principal
async function getSubtagsByMainTag(filePath, brandName, mainTag) {
    try {
        // Mapeo de etiquetas principales a sus subetiquetas
        const tagStructure = {
            'RECEPCIONES': [
                'TotalRecepcionesMes',
                'ValorNumerico',
                'TotalDocumentosMes',
                'ImporteTotalRecepciones'
            ],
            'CONTROLDEEXISTENCIAS': [
                'ValorNumerico',
                'FechaYHoraEstaMedicionMes'
            ],
            'ENTREGAS': [
                'TotalEntregasMes',
                'ValorNumerico',
                'TotalDocumentosMes',
                'ImporteTotalEntregasMes'
            ]
        };

        if (!tagStructure[mainTag]) {
            throw new Error(`Etiqueta principal '${mainTag}' no reconocida`);
        }

        const xmlData = fs.readFileSync(filePath, 'utf-8');
        const parser = new xml2js.Parser(parserOptions);
        const result = await parser.parseStringPromise(xmlData);
        const availableSubtags = new Set();

        const searchSubtags = (node, inBrandContext = false) => {
            if (!node) return;

            // Verificar contexto de marca
            if (node.MarcaComercial) {
                const currentBrand = typeof node.MarcaComercial === 'string' 
                    ? node.MarcaComercial 
                    : (node.MarcaComercial._ || '');
                inBrandContext = (currentBrand.trim() === brandName.trim());
            }

            // Buscar la etiqueta principal y sus subetiquetas
            if (inBrandContext && node[mainTag]) {
                const mainNode = node[mainTag];
                tagStructure[mainTag].forEach(subtag => {
                    if (mainNode[subtag]) {
                        availableSubtags.add(subtag);
                    }
                });
            }

            // Búsqueda recursiva
            Object.values(node).forEach(child => {
                if (typeof child === 'object') {
                    searchSubtags(child, inBrandContext);
                }
            });
        };

        searchSubtags(result);
        
        // Devolver solo las subetiquetas existentes, en el orden definido
        return tagStructure[mainTag].filter(subtag => availableSubtags.has(subtag));

    } catch (error) {
        console.error('Error en getSubtagsByMainTag:', error);
        throw new Error(`Error obteniendo subetiquetas: ${error.message}`);
    }
}

// Función para obtener los valores de las subetiquetas
async function getSubtagValues(filePath, brandName, mainTag, subtags) {
    try {
        const xmlData = fs.readFileSync(filePath, 'utf-8');
        const parser = new xml2js.Parser(parserOptions);
        const result = await parser.parseStringPromise(xmlData);
        const values = {};

        const searchValues = (node, inBrandContext = false) => {
            if (!node || Object.keys(values).length === subtags.length) return;

            // Verificar contexto de marca
            if (node.MarcaComercial) {
                const currentBrand = typeof node.MarcaComercial === 'string' 
                    ? node.MarcaComercial 
                    : (node.MarcaComercial._ || '');
                inBrandContext = (currentBrand.trim() === brandName.trim());
            }

            // Buscar valores en la etiqueta principal
            if (inBrandContext && node[mainTag]) {
                const mainNode = node[mainTag];
                subtags.forEach(subtag => {
                    if (mainNode[subtag] && !values[subtag]) {
                        values[subtag] = typeof mainNode[subtag] === 'string' 
                            ? mainNode[subtag] 
                            : (mainNode[subtag]._ || '');
                    }
                });
            }

            // Búsqueda recursiva
            Object.values(node).forEach(child => {
                if (typeof child === 'object') {
                    searchValues(child, inBrandContext);
                }
            });
        };

        searchValues(result);
        return values;

    } catch (error) {
        console.error('Error en getSubtagValues:', error);
        throw new Error(`Error obteniendo valores: ${error.message}`);
    }
}

// Función para generar reporte XML
function generateXMLFile(selectedData, outputPath) {
    try {
        if (!selectedData || selectedData.length === 0) {
            throw new Error('No hay datos seleccionados para generar el reporte.');
        }

        const xmlBuilder = new xml2js.Builder({
            rootName: 'Reporte',
            xmldec: { version: '1.0', encoding: 'UTF-8' }
        });

        const xmlData = {
            Item: selectedData.map(item => ({
                Marca: item.brandName,
                Categoria: item.mainTag,
                Datos: item.values
            }))
        };

        const xmlContent = xmlBuilder.buildObject(xmlData);
        fs.writeFileSync(outputPath, xmlContent, 'utf-8');
        return outputPath;

    } catch (error) {
        console.error('Error al generar el archivo XML:', error);
        throw new Error(`Error generando reporte: ${error.message}`);
    }
}

module.exports = {
    extractBrands,
    getSubtagsByMainTag,
    getSubtagValues,
    generateXMLFile
};