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
    const generateTxtBtn = document.getElementById('generate-txt-btn');
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
            
            // Cargar marcas comerciales
            const brands = await window.electronAPI.extractBrands(currentFilePath);
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
            
            document.getElementById('brand-section').style.display = 'block';
            updateStatus('Archivo cargado exitosamente', 'success');
            
        } catch (error) {
            console.error('Error al cargar archivo:', error);
            updateStatus(`Error: ${error.message}`, 'error');
        }
    }
    
    // 2. Confirmar selección de marcas
    confirmBrandsBtn.addEventListener('click', function() {
        const checkboxes = document.querySelectorAll('.brand-checkbox:checked');
        selectedBrands = Array.from(checkboxes).map(cb => cb.value);
        
        if (selectedBrands.length === 0) {
            updateStatus('Seleccione al menos una marca', 'warning');
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
    
    searchBtn.addEventListener('click', async function() {
        try {
            // Obtener subetiquetas seleccionadas
            const subtagCheckboxes = document.querySelectorAll('#data-container input[type="checkbox"]:checked');
            const selectedSubtags = Array.from(subtagCheckboxes).map(cb => cb.value);
            
            if (selectedSubtags.length === 0) {
                updateStatus('Seleccione al menos una subetiqueta', 'warning');
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
                    updateStatus(`Error con ${brand}: ${error.message}`, 'error', 3000);
                }
            }
            
            if (!foundAnyData) {
                updateStatus('No se encontraron datos para los criterios seleccionados', 'warning');
                return;
            }
            
            renderResultsTable();
            document.getElementById('results-section').style.display = 'block';
            updateStatus(`Datos encontrados para ${allResults.length} marca(s)`, 'success');
            
        } catch (error) {
            console.error('Error en el proceso de búsqueda:', error);
            updateStatus(`Error: ${error.message}`, 'error');
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
        
        allResults.forEach(brandData => {
            brandData.values.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><input type="checkbox" class="row-checkbox" 
                         data-brand="${brandData.brand}" 
                         data-key="${item.key}" 
                         data-value="${item.value}"></td>
                    <td>${brandData.brand}</td>
                    <td>${brandData.mainTag}</td>
                    <td>${item.key}</td>
                    <td>${item.value}</td>
                `;
                tbody.appendChild(tr);
            });
        });
        
        updateSelectedCount();
    }
    
    // 5. Selección de resultados
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
    
    // Checkbox "Seleccionar todos"
    document.getElementById('select-all-checkbox').addEventListener('change', function() {
        const checkboxes = document.querySelectorAll('.row-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = this.checked;
        });
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
            return;
        }
        
        checkboxes.forEach(checkbox => {
            const row = checkbox.closest('tr');
            const cells = row.querySelectorAll('td');
            const brand = checkbox.dataset.brand;
            const key = checkbox.dataset.key;
            const value = cells[4].textContent;
            
            // Verificar si ya existe
            const exists = selectedData.some(item => 
                item.brand === brand && item.mainTag === selectedMainTag && item.key === key
            );
            
            if (!exists) {
                selectedData.push({
                    brand,
                    mainTag: selectedMainTag,
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
                    <span class="remove-btn" data-brand="${item.brand}" data-key="${item.key}">
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
                            data-brand="${item.brand}" data-key="${item.key}">
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
                const key = this.dataset.key;
                
                selectedData = selectedData.filter(item => 
                    !(item.brand === brand && item.key === key)
                );
                
                renderSelectedData();
                
                if (selectedData.length === 0) {
                    document.getElementById('generate-section').style.display = 'none';
                }
                
                updateStatus(`"${key}" eliminado del reporte`, 'info');
            });
        });
    }
    
    // 7. Generar reportes
    async function generateReport(formatType) {
        try {
            if (selectedData.length === 0) {
                updateStatus('No hay datos seleccionados', 'warning');
                return;
            }
            
            updateStatus(`Generando reporte ${formatType.toUpperCase()}...`, 'info');
            showProgress(25);
            
            // Extraer metadatos
            const metadata = await window.electronAPI.extractMetadata(currentFilePath);
            
            // Preparar datos para el reporte
            const reportData = {
                selectedTags: selectedData.map(item => ({
                    brand: item.brand,
                    mainTag: item.mainTag,
                    key: item.key,
                    value: item.value
                })),
                brands: [...new Set(selectedData.map(item => item.brand))],
                descripcionInstalacion: metadata.descripcionInstalacion,
                numPermiso: metadata.numPermiso
            };
            
            // Generar reporte
            const reportPath = await window.electronAPI.generateReport(reportData, formatType);
            
            showProgress(100);
            updateStatus(`Reporte ${formatType.toUpperCase()} generado: ${path.basename(reportPath)}`, 'success');
            resetProgressAfterDelay();
            
        } catch (error) {
            console.error(`Error al generar ${formatType}:`, error);
            updateStatus(`Error al generar ${formatType}: ${error.message}`, 'error');
            resetProgress();
        }
    }
    // Event listeners para botones de generación
    generateTxtBtn.addEventListener('click', () => generateReport('txt'));
    generatePdfBtn.addEventListener('click', () => generateReport('pdf'));
    
    // Funciones auxiliares para la barra de progreso
    function showProgress(percent) {
        const progressBar = document.getElementById('progress-bar');
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }
    }
    
    function resetProgress() {
        const progressBar = document.getElementById('progress-bar');
        if (progressBar) {
            progressBar.style.width = '0%';
        }
    }
    
    function resetProgressAfterDelay(delay = 3000) {
        setTimeout(resetProgress, delay);
    }
    
    // Inicializar
    selectFileBtn.addEventListener('click', selectFile);
    
    // Polyfill para path.basename
    const path = {
        basename: (filePath) => {
            return filePath.split(/[\\/]/).pop();
        }
    };
});