document.addEventListener('DOMContentLoaded', () => {
    // Variables de estado
    let currentFilePath = null;
    let selectedBrands = [];
    let selectedMainTag = null;
    let selectedData = [];
    let allResults = [];
    
    // Elementos del DOM
    const selectFileBtn = document.getElementById('select-file-btn');
    const brandCheckboxesContainer = document.getElementById('brand-checkboxes');
    const selectAllBrandsCheckbox = document.getElementById('select-all-brands');
    const confirmBrandsBtn = document.getElementById('confirm-brands-btn');
    const mainTagSelect = document.getElementById('main-tag-select');
    const searchBtn = document.getElementById('search-btn');
    const resultsTable = document.getElementById('results-table');
    const selectAllResultsBtn = document.getElementById('select-all-results');
    const clearSelectionBtn = document.getElementById('clear-selection');
    const addSelectedBtn = document.getElementById('add-selected-btn');
    const generatePdfBtn = document.getElementById('generate-pdf-btn');
    
    // Función para actualizar el estado
    function updateStatus(message, type = 'info') {
        const statusElement = document.getElementById('status');
        if (!statusElement) return;
        
        const icons = {
            'info': '⏳',
            'success': '✅',
            'warning': '⚠️',
            'error': '❌'
        };
        
        statusElement.innerHTML = `<span class="icon">${icons[type]}</span><span>${message}</span>`;
        statusElement.className = `alert alert-${type}`;
    }
    
    // Función para mostrar errores
    function showErrorMessage(message, title = 'Error') {
        const errorElement = document.getElementById('error-message') || document.createElement('div');
        errorElement.id = 'error-message';
        errorElement.innerHTML = `
            <div class="alert alert-danger">
                <strong>${title}:</strong> ${message}
            </div>
        `;
        document.body.appendChild(errorElement);
        setTimeout(() => errorElement.remove(), 5000);
    }

    // 1. Cargar archivo XML
    async function selectFile() {
        try {
            updateStatus('Cargando archivo...', 'info');
            
            const fileInfo = await window.electronAPI.openFileDialog();
            if (!fileInfo?.path) {
                updateStatus('No se seleccionó ningún archivo', 'info');
                return;
            }
            
            currentFilePath = fileInfo.path;
            document.getElementById('file-info').innerHTML = 
                `<span class="icon">ℹ️</span><span>Archivo: ${path.basename(fileInfo.path)} (${fileInfo.size})</span>`;
            
            // Cargar marcas y categorías en paralelo
            const [brands, categories] = await Promise.all([
                window.electronAPI.extractBrands(currentFilePath),
                window.electronAPI.extractCategories(currentFilePath)
            ]);
            
            if (!brands?.length) {
                updateStatus('El archivo no contiene marcas comerciales válidas', 'warning');
                return;
            }
            
            // Mostrar checkboxes de marcas
            brandCheckboxesContainer.innerHTML = '';
            
            // Checkbox "Seleccionar todas"
            const selectAllDiv = document.createElement('div');
            selectAllDiv.className = 'form-check';
            selectAllDiv.innerHTML = `
                <input class="form-check-input" type="checkbox" id="select-all-brands">
                <label class="form-check-label" for="select-all-brands">Seleccionar todas</label>
            `;
            brandCheckboxesContainer.appendChild(selectAllDiv);
            
            // Checkboxes para cada marca
            brands.forEach(brand => {
                const div = document.createElement('div');
                div.className = 'form-check';
                div.innerHTML = `
                    <input class="form-check-input brand-checkbox" type="checkbox" id="brand-${brand}" value="${brand}">
                    <label class="form-check-label" for="brand-${brand}">${brand}</label>
                `;
                brandCheckboxesContainer.appendChild(div);
            });
            
            // Event listeners para selección
            document.getElementById('select-all-brands').addEventListener('change', function() {
                const checkboxes = document.querySelectorAll('.brand-checkbox');
                checkboxes.forEach(checkbox => {
                    checkbox.checked = this.checked;
                });
                confirmBrandsBtn.style.display = this.checked ? 'block' : 'none';
            });
            
            const brandCheckboxes = document.querySelectorAll('.brand-checkbox');
            brandCheckboxes.forEach(checkbox => {
                checkbox.addEventListener('change', function() {
                    const anyChecked = [...brandCheckboxes].some(cb => cb.checked);
                    confirmBrandsBtn.style.display = anyChecked ? 'block' : 'none';
                    selectAllBrandsCheckbox.checked = [...brandCheckboxes].every(cb => cb.checked);
                });
            });
            
            // Actualizar el selector de categorías
            mainTagSelect.innerHTML = '<option value="">-- Seleccione categoría --</option>';
            categories.forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                mainTagSelect.appendChild(option);
            });
            
            document.getElementById('brand-section').style.display = 'block';
            updateStatus('Archivo cargado exitosamente', 'success');
            
        } catch (error) {
            console.error('Error al cargar archivo:', error);
            updateStatus(`Error: ${error.message}`, 'error');
            showErrorMessage(error.message, 'Error al cargar archivo');
        }
    }
    
    // 2. Confirmar selección de marcas
    confirmBrandsBtn.addEventListener('click', function() {
        const checkboxes = document.querySelectorAll('.brand-checkbox:checked');
        selectedBrands = Array.from(checkboxes).map(cb => cb.value);
        
        if (selectedBrands.length === 0) {
            updateStatus('Seleccione al menos una marca', 'warning');
            showErrorMessage('Debe seleccionar al menos una marca', 'Selección requerida');
            return;
        }
        
        document.getElementById('category-section').style.display = 'block';
        updateStatus(`${selectedBrands.length} marca(s) seleccionada(s)`, 'success');
    });
    
    // 3. Seleccionar categoría principal
    mainTagSelect.addEventListener('change', function() {
        selectedMainTag = this.value;
        if (!selectedMainTag) {
            updateStatus('Seleccione una categoría', 'warning');
            return;
        }
        
        // Definir subetiquetas según la categoría seleccionada
        const subtagsByCategory = {
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
        
        const subtags = subtagsByCategory[selectedMainTag] || [];
        
        // Mostrar las subetiquetas disponibles
        const dataContainer = document.getElementById('data-container');
        dataContainer.innerHTML = `
            <h3>Subetiquetas disponibles para ${selectedMainTag}</h3>
            <div class="subtags-list">
                ${subtags.map(subtag => `
                    <div class="form-check">
                        <input class="form-check-input subtag-checkbox" 
                               type="checkbox" 
                               id="subtag-${subtag}" 
                               value="${subtag}" 
                               checked>
                        <label class="form-check-label" for="subtag-${subtag}">${subtag}</label>
                    </div>
                `).join('')}
            </div>
        `;
        
        document.getElementById('data-section').style.display = 'block';
        updateStatus(`Categoría "${selectedMainTag}" seleccionada`, 'success');
    });
    
    // 4. Buscar datos
    searchBtn.addEventListener('click', async function() {
        try {
            // Obtener subetiquetas seleccionadas
            const subtagCheckboxes = document.querySelectorAll('#data-container input[type="checkbox"]:checked');
            const selectedSubtags = Array.from(subtagCheckboxes).map(cb => cb.value);
            
            if (selectedSubtags.length === 0) {
                updateStatus('Seleccione al menos una subetiqueta', 'warning');
                showErrorMessage('Debe seleccionar al menos una subetiqueta', 'Búsqueda inválida');
                return;
            }
    
            updateStatus('Buscando datos...', 'info');
            
            // Buscar datos para todas las marcas seleccionadas
            allResults = [];
            let foundAnyData = false;
            
            for (const brand of selectedBrands) {
                try {
                    console.log(`Buscando datos para: ${brand}`);
                    const values = await window.electronAPI.getSubtagValues(
                        currentFilePath,
                        brand,
                        selectedMainTag,
                        selectedSubtags
                    );
                    
                    console.log(`Resultados para ${brand}:`, values);
                    
                    if (values && Object.keys(values).length > 0) {
                        foundAnyData = true;
                        const brandResults = {
                            brand,
                            mainTag: selectedMainTag,
                            values: []
                        };
                        
                        // Asegurar que todas las subetiquetas aparezcan en el resultado
                        selectedSubtags.forEach(subtag => {
                            brandResults.values.push({
                                key: subtag,
                                value: values[subtag] !== undefined && values[subtag] !== null ? 
                                      values[subtag] : 'N/D'
                            });
                        });
                        
                        allResults.push(brandResults);
                    }
                } catch (error) {
                    console.error(`Error al buscar datos para ${brand}:`, error);
                    updateStatus(`Error con ${brand}: ${error.message}`, 'error');
                }
            }
            
            if (!foundAnyData) {
                updateStatus('No se encontraron datos para los criterios seleccionados', 'warning');
                showErrorMessage('No se encontraron datos con los criterios actuales', 'Búsqueda sin resultados');
                return;
            }
            
            renderResultsTable();
            document.getElementById('results-section').style.display = 'block';
            updateStatus(`Datos encontrados para ${allResults.length} marca(s)`, 'success');
            
        } catch (error) {
            console.error('Error en el proceso de búsqueda:', error);
            updateStatus(`Error: ${error.message}`, 'error');
            showErrorMessage(error.message, 'Error en la búsqueda');
        }
    });
    
    // Función para renderizar la tabla de resultados
    function renderResultsTable() {
        const tbody = resultsTable.querySelector('tbody');
        tbody.innerHTML = '';
        
        if (allResults.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center">No se encontraron resultados</td>
                </tr>
            `;
            return;
        }
        
        // Agrupar por marca y categoría
        const groupedResults = {};
        
        allResults.forEach(brandData => {
            if (!groupedResults[brandData.brand]) {
                groupedResults[brandData.brand] = {};
            }
            if (!groupedResults[brandData.brand][brandData.mainTag]) {
                groupedResults[brandData.brand][brandData.mainTag] = [];
            }
            groupedResults[brandData.brand][brandData.mainTag].push(...brandData.values);
        });
        
        // Renderizar tabla
        Object.keys(groupedResults).forEach(brand => {
            Object.keys(groupedResults[brand]).forEach(category => {
                groupedResults[brand][category].forEach(item => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><input type="checkbox" class="row-checkbox" 
                             data-brand="${brand}" 
                             data-category="${category}"
                             data-key="${item.key}" 
                             data-value="${item.value}"></td>
                        <td>${brand}</td>
                        <td>${category}</td>
                        <td>${item.key}</td>
                        <td>${item.value}</td>
                    `;
                    tbody.appendChild(tr);
                });
            });
        });
        
        updateSelectedCount();
    }
    
    // 5. Manejo de selección de resultados
    function updateSelectedCount() {
        const selectedCount = document.querySelectorAll('.row-checkbox:checked').length;
        document.getElementById('selected-count').textContent = `${selectedCount} seleccionados`;
    }
    
    // Seleccionar todos los resultados
    selectAllResultsBtn.addEventListener('click', function() {
        const selectAll = document.getElementById('select-all-checkbox');
        selectAll.checked = !selectAll.checked;
        const checkboxes = document.querySelectorAll('.row-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = selectAll.checked;
        });
        updateSelectedCount();
    });
    
    // Limpiar selección
    clearSelectionBtn.addEventListener('click', function() {
        const checkboxes = document.querySelectorAll('.row-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
        document.getElementById('select-all-checkbox').checked = false;
        updateSelectedCount();
    });
    
    // Event listener para checkboxes individuales
    resultsTable.addEventListener('change', function(e) {
        if (e.target.classList.contains('row-checkbox')) {
            const allChecked = [...document.querySelectorAll('.row-checkbox')].every(cb => cb.checked);
            document.getElementById('select-all-checkbox').checked = allChecked;
            updateSelectedCount();
        }
    });
    
    // 6. Agregar seleccionados al reporte
    addSelectedBtn.addEventListener('click', function() {
        const checkboxes = document.querySelectorAll('.row-checkbox:checked');
        
        if (checkboxes.length === 0) {
            updateStatus('Seleccione al menos un dato para agregar', 'warning');
            showErrorMessage('Debe seleccionar al menos un dato', 'Selección requerida');
            return;
        }
        
        checkboxes.forEach(checkbox => {
            const brand = checkbox.dataset.brand;
            const category = checkbox.dataset.category;
            const key = checkbox.dataset.key;
            const value = checkbox.dataset.value;
            
            // Verificar si ya existe
            const exists = selectedData.some(item => 
                item.brand === brand && 
                item.mainTag === category && 
                item.key === key
            );
            
            if (!exists) {
                selectedData.push({
                    brand,
                    mainTag: category,
                    key,
                    value
                });
            }
        });
        
        renderSelectedData();
        document.getElementById('generate-section').style.display = 'block';
        updateStatus(`${checkboxes.length} dato(s) agregado(s) al reporte`, 'success');
    });
    
    // Función para renderizar los datos seleccionados
    function renderSelectedData() {
        const container = document.getElementById('selected-tags-container');
        const tableBody = document.getElementById('selected-data-table').querySelector('tbody');
        
        // Actualizar chips
        container.innerHTML = selectedData.length > 0 
            ? selectedData.map(item => `
                <div class="tag-chip">
                    ${item.brand} - ${item.key}
                    <span class="remove-btn" data-brand="${item.brand}" data-category="${item.mainTag}" data-key="${item.key}">
                        <span class="icon">❌</span>
                    </span>
                </div>
            `).join('')
            : '<div class="text-muted">No hay datos seleccionados</div>';
        
        // Actualizar tabla
        tableBody.innerHTML = selectedData.length > 0
            ? selectedData.map(item => `
                <tr>
                    <td>${item.brand}</td>
                    <td>${item.mainTag}</td>
                    <td>${item.key}</td>
                    <td>${item.value}</td>
                    <td>
                        <button class="btn btn-sm btn-danger remove-selected" 
                            data-brand="${item.brand}" data-category="${item.mainTag}" data-key="${item.key}">
                            <span class="icon">🗑️</span>
                        </button>
                    </td>
                </tr>
            `).join('')
            : '<tr><td colspan="5" class="text-center">No hay datos seleccionados</td></tr>';
        
        // Agregar event listeners para eliminar
        document.querySelectorAll('.remove-btn, .remove-selected').forEach(btn => {
            btn.addEventListener('click', function() {
                const brand = this.dataset.brand;
                const category = this.dataset.category;
                const key = this.dataset.key;
                
                selectedData = selectedData.filter(item => 
                    !(item.brand === brand && item.mainTag === category && item.key === key)
                );
                
                renderSelectedData();
                
                if (selectedData.length === 0) {
                    document.getElementById('generate-section').style.display = 'none';
                }
                
                updateStatus(`"${key}" eliminado del reporte`, 'info');
            });
        });
    }
    
    // 7. Generar reporte PDF
    async function generatePDF() {
        try {
            updateStatus('Preparando reporte PDF...', 'info');
            
            // Validar antes de generar
            if (selectedData.length === 0) {
                throw new Error('No hay datos seleccionados para generar el reporte');
            }
            if (!currentFilePath) {
                throw new Error('No se ha cargado ningún archivo fuente');
            }
    
            // Obtener metadatos del archivo XML
            const metadata = await window.electronAPI.extractMetadata(currentFilePath);
            console.log('Metadata obtenida:', metadata);
    
            // Preparar estructura de datos para el PDF
            const reportData = {
                selectedTags: selectedData.map(item => ({
                    brand: String(item.brand || 'Sin marca'),
                    mainTag: String(item.mainTag || 'Sin categoría'),
                    key: String(item.key || 'Sin clave'),
                    value: String(item.value || 'Sin valor')
                })),
                brands: [...new Set(selectedData.map(item => item.brand))],
                metadata: {
                    numPermiso: metadata.numPermiso,
                    descripcionInstalacion: metadata.descripcionInstalacion,
                    fechaMedicion: metadata.fechaMedicion
                }
            };
    
            console.log('Datos para PDF:', reportData);
    
            // Generar reporte
            updateStatus('Generando archivo PDF...', 'info');
            const result = await window.electronAPI.generateReport(reportData, 'pdf');
            
            if (result && !result.canceled) {
                updateStatus(`Reporte PDF guardado en: ${result.path}`, 'success');
                window.notifications.showNotification(
                    'Reporte PDF generado',
                    `Archivo guardado en:\n${result.path}`
                );
                return result;
            }
            
        } catch (error) {
            console.error('Error al generar PDF:', error);
            updateStatus(`Error al generar PDF: ${error.message}`, 'error');
            showErrorMessage(error.message, 'Error al generar PDF');
            throw error;
        }
    }

    // Asignar event listener para generación de PDF
    generatePdfBtn.addEventListener('click', generatePDF);

    // Funciones auxiliares para la barra de progreso
    function showProgress(percent) {
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (progressText) progressText.textContent = `${percent}%`;
    }
    
    function resetProgress() {
        showProgress(0);
    }
    
    function resetProgressAfterDelay(delay = 3000) {
        setTimeout(resetProgress, delay);
    }
    
    // Inicialización
    selectFileBtn.addEventListener('click', selectFile);
    
    // Polyfill para path.basename
    const path = {
        basename: (filePath) => {
            return filePath.split(/[\\/]/).pop();
        },
        join: (...parts) => {
            return parts.join('/').replace(/\/+/g, '/');
        }
    };
});