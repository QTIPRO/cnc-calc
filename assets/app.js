const DEFAULTS = {
  quantity: 1,
  currency: "₽",
  materialKey: "al6061",
  materialPrice: 650, // ₽/кг
  partWeight: 0.25, // кг
  scrapRate: 5, // %
  // Операции обработки
  operations: [
    { type: "milling", setupMinutes: 30, cycleMinutes: 15, machineRatePerHour: 1200, shift: "day" },
  ],
  shiftMultipliers: { day: 1.0, night: 1.15 },
  // Прочее
  toolingPerPart: 0,
  toolingPerBatch: 0,
  postProcessPerPart: 0,
  shippingPerBatch: 0,
  overheadPct: 15,
  marginPct: 20,
  vatPct: 0,
};

const MATERIALS = [
  { key: "al6061", label: "Al 6061-T6 (дюраль)", pricePerKg: 650 },
  { key: "al7075", label: "Al 7075-T6", pricePerKg: 900 },
  { key: "steel45", label: "Сталь 45", pricePerKg: 120 },
  { key: "stainless304", label: "Нерж 12Х18Н10Т (AISI 304)", pricePerKg: 420 },
  { key: "titaniumTi6Al4V", label: "Титан ВТ6 (Ti-6Al-4V)", pricePerKg: 3000 },
  { key: "custom", label: "Своя цена…", pricePerKg: DEFAULTS.materialPrice },
];

// Типовые ставки по видам станков (можете подстроить под свои)
const MACHINE_RATE_PRESETS = {
  latheCNC: 1200,
  mill3axis: 1400,
  mill5axis: 2200,
};

function byId(id){ return document.getElementById(id); }

const state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem("cnc_estimator_v1");
    if(!raw) return { ...DEFAULTS };
    const data = JSON.parse(raw);
    // Миграция со старых версий без operations
    const migrated = { ...DEFAULTS, ...data };
    if(!Array.isArray(migrated.operations)){
      const setupTime = Number(data.setupTime) || DEFAULTS.operations[0].setupMinutes;
      const cycleTime = Number(data.cycleTime) || DEFAULTS.operations[0].cycleMinutes;
      const machineRate = Number(data.machineRate) || DEFAULTS.operations[0].machineRatePerHour;
      migrated.operations = [{ type: "milling", setupMinutes: setupTime, cycleMinutes: cycleTime, machineRatePerHour: machineRate, shift: "day" }];
    }
    if(!migrated.shiftMultipliers){ migrated.shiftMultipliers = { ...DEFAULTS.shiftMultipliers }; }
    return migrated;
  }catch(e){ return { ...DEFAULTS }; }
}

function saveState(){
  localStorage.setItem("cnc_estimator_v1", JSON.stringify(state));
}

function initMaterialSelect(){
  const sel = byId("material");
  sel.innerHTML = MATERIALS.map(m => `<option value="${m.key}">${m.label}</option>`).join("");
  sel.value = state.materialKey;
}

function syncInputsFromState(){
  byId("quantity").value = state.quantity;
  byId("currency").value = state.currency;
  byId("materialPrice").value = state.materialPrice;
  byId("partWeight").value = state.partWeight;
  byId("scrapRate").value = state.scrapRate;
  byId("toolingPerPart").value = state.toolingPerPart;
  byId("toolingPerBatch").value = state.toolingPerBatch;
  byId("postProcessPerPart").value = state.postProcessPerPart;
  byId("shippingPerBatch").value = state.shippingPerBatch;
  byId("overheadPct").value = state.overheadPct;
  byId("marginPct").value = state.marginPct;
  byId("vatPct").value = state.vatPct;
  byId("shiftDayMult").value = state.shiftMultipliers.day;
  byId("shiftNightMult").value = state.shiftMultipliers.night;
  renderOperations();
  const qcQty = byId('qcQty');
  if(qcQty){ qcQty.value = state.quantity; }
}

function bindInputs(){
  const setNum = (k) => (e)=>{ state[k] = Number(e.target.value) || 0; saveState(); recalc(); };
  const setStr = (k) => (e)=>{ state[k] = String(e.target.value || ""); saveState(); recalc(); };

  byId("quantity").addEventListener("input", setNum("quantity"));
  byId("currency").addEventListener("input", setStr("currency"));
  byId("material").addEventListener("change", (e)=>{
    state.materialKey = e.target.value;
    const preset = MATERIALS.find(m => m.key === state.materialKey);
    if(preset && preset.key !== "custom"){ state.materialPrice = preset.pricePerKg; byId("materialPrice").value = state.materialPrice; }
    saveState(); recalc();
  });

  [
    ["materialPrice","materialPrice"],
    ["partWeight","partWeight"],
    ["scrapRate","scrapRate"],
    ["toolingPerPart","toolingPerPart"],
    ["toolingPerBatch","toolingPerBatch"],
    ["postProcessPerPart","postProcessPerPart"],
    ["shippingPerBatch","shippingPerBatch"],
    ["overheadPct","overheadPct"],
    ["marginPct","marginPct"],
    ["vatPct","vatPct"],
  ].forEach(([id,key])=> byId(id).addEventListener("input", setNum(key)) );

  byId("shiftDayMult").addEventListener("input", (e)=>{
    state.shiftMultipliers.day = Number(e.target.value)||1; saveState(); recalc();
  });
  byId("shiftNightMult").addEventListener("input", (e)=>{
    state.shiftMultipliers.night = Number(e.target.value)||1; saveState(); recalc();
  });

  // Операции
  byId("addOpBtn").addEventListener("click", ()=>{
    state.operations.push({ type: "milling", setupMinutes: 0, cycleMinutes: 0, machineRatePerHour: 1200, shift: "day" });
    saveState(); renderOperations(); recalc();
  });

  byId("resetBtn").addEventListener("click", ()=>{
    Object.assign(state, { ...DEFAULTS });
    saveState();
    initMaterialSelect();
    syncInputsFromState();
    recalc();
  });

  byId("exportBtn").addEventListener("click", ()=>{
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cnc-preset-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  byId("importInput").addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const text = await file.text();
      const data = JSON.parse(text);
      Object.assign(state, { ...DEFAULTS, ...data });
      saveState();
      initMaterialSelect();
      syncInputsFromState();
      recalc();
    }catch(err){
      alert("Ошибка импорта: некорректный JSON");
    }finally{
      e.target.value = "";
    }
  });

  // Экспорт CSV (Excel)
  byId("csvBtn").addEventListener("click", ()=>{
    const { csv, filename } = buildCSV();
    // Добавляем BOM для корректного открытия в Excel на Windows
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Печать КП (PDF через диалог печати)
  byId("printBtn").addEventListener("click", ()=>{
    openPrintWindow();
  });

  // Быстрый калькулятор (токарка)
  const qcMode = byId('qcMode');
  const qcResult = byId('qcResult');
  const qcMatRow = byId('qcMatRow');
  const recalcQC = ()=>{
    if(qcMode?.value === 'turning'){
      const res = quickCalcTurning();
      qcResult.textContent = `наладка ~${Math.round(res.setupMin)} мин, цикл ~${res.cycleMin.toFixed(1)} мин/шт`;
      return res;
    }
    if(qcMode?.value === 'milling'){
      const res = quickCalcMilling();
      qcResult.textContent = `наладка ~${Math.round(res.setupMin)} мин, цикл ~${res.cycleMin.toFixed(1)} мин/шт`;
      return res;
    }
    return { setupMin: 0, cycleMin: 0 };
  };
  if(byId('qcCalcBtn')){
    byId('qcCalcBtn').addEventListener('click', recalcQC);
  }
  if(byId('qcApplyBtn')){
    byId('qcApplyBtn').addEventListener('click', ()=>{
      const { setupMin, cycleMin } = recalcQC();
      const rateInput = Number(byId('qcRate')?.value)||0;
      const fallbackRate = (state.operations?.[0]?.machineRatePerHour) || DEFAULTS.operations[0].machineRatePerHour;
      const machineRate = rateInput>0?rateInput:fallbackRate;
      const type = qcMode?.value === 'milling' ? 'milling' : 'turning';
      state.operations.push({ type, setupMinutes: Math.round(setupMin), cycleMinutes: cycleMin, machineRatePerHour: machineRate, shift: 'day' });
      saveState(); renderOperations(); recalc();
    });
  }
  if(byId('qcCalcBtn_m')){
    byId('qcCalcBtn_m').addEventListener('click', recalcQC);
  }
  if(byId('qcApplyBtn_m')){
    byId('qcApplyBtn_m').addEventListener('click', ()=>{
      qcMode.value = 'milling';
      const { setupMin, cycleMin } = recalcQC();
      const rateInput = Number(byId('qcRate')?.value)||0;
      const fallbackRate = (state.operations?.[0]?.machineRatePerHour) || DEFAULTS.operations[0].machineRatePerHour;
      const machineRate = rateInput>0?rateInput:fallbackRate;
      state.operations.push({ type: 'milling', setupMinutes: Math.round(setupMin), cycleMinutes: cycleMin, machineRatePerHour: machineRate, shift: 'day' });
      saveState(); renderOperations(); recalc();
    });
  }

  // Переключение режимов интерфейса быстрых калькуляторов
  const turningBox = byId('qcTurning');
  const millingBox = byId('qcMilling');
  const toggleQCBoxes = ()=>{
    if(!qcMode) return;
    const mode = qcMode.value;
    if(mode==='turning'){
      turningBox.style.display = '';
      millingBox.style.display = 'none';
      qcMatRow.style.display = '';
    }else{
      turningBox.style.display = 'none';
      millingBox.style.display = '';
      qcMatRow.style.display = '';
    }
    // Пресет ставки для выбранного типа станка
    const mSel = byId('qcMachineType');
    const rateInput = byId('qcRate');
    const key = mSel?.value || (mode==='turning'?'latheCNC':'mill3axis');
    const preset = MACHINE_RATE_PRESETS[key];
    if(rateInput && Number(rateInput.value||0)===0 && preset){
      rateInput.value = String(preset);
    }
    recalcQC();
  };
  qcMode?.addEventListener('change', toggleQCBoxes);
  byId('qcMachineType')?.addEventListener('change', ()=>{
    const mSel = byId('qcMachineType');
    const rateInput = byId('qcRate');
    const preset = MACHINE_RATE_PRESETS[mSel.value];
    if(rateInput && preset){ rateInput.value = String(preset); }
  });
  toggleQCBoxes();

  // Связка количества в QC с основным количеством
  const qcQty = byId('qcQty');
  if(qcQty){
    qcQty.addEventListener('input', (e)=>{
      const val = Math.max(1, Number(e.target.value)||1);
      state.quantity = val;
      const qtyInput = byId('quantity');
      if(qtyInput){ qtyInput.value = val; }
      saveState();
      recalc();
    });
  }

  // Мобильные клавиатуры для числовых полей
  document.querySelectorAll('input[type="number"]').forEach((el)=>{
    el.setAttribute('inputmode','decimal');
    el.setAttribute('pattern','[0-9]*');
  });

  // Пресеты
  byId("savePresetBtn").addEventListener("click", ()=>{
    const name = (byId("presetName").value || "").trim();
    if(!name){ alert("Введите название пресета"); return; }
    savePreset(name, snapshotState());
    refreshPresetsSelect();
    byId("presetSelect").value = name;
  });
  byId("loadPresetBtn").addEventListener("click", ()=>{
    const name = byId("presetSelect").value;
    if(!name){ alert("Нет выбранного пресета"); return; }
    const snap = getPresets()[name];
    if(!snap){ alert("Пресет не найден"); return; }
    Object.assign(state, { ...DEFAULTS, ...snap });
    saveState();
    initMaterialSelect();
    syncInputsFromState();
    recalc();
  });
  byId("deletePresetBtn").addEventListener("click", ()=>{
    const name = byId("presetSelect").value;
    if(!name){ alert("Выберите пресет для удаления"); return; }
    const ok = confirm(`Удалить пресет "${name}"?`);
    if(!ok) return;
    const presets = getPresets();
    delete presets[name];
    localStorage.setItem("cnc_estimator_presets_v1", JSON.stringify(presets));
    refreshPresetsSelect();
  });
}

function formatMoney(value, currency){
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return `${rounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function compute(){
  const qty = Math.max(1, Number(state.quantity) || 1);

  // Материал
  const weightPerPartKg = Math.max(0, Number(state.partWeight) || 0);
  const scrapMultiplier = 1 + (Math.max(0, Number(state.scrapRate) || 0) / 100);
  const buyWeightPerPartKg = weightPerPartKg * scrapMultiplier;
  const materialPricePerKg = Math.max(0, Number(state.materialPrice) || 0);
  const materialCostPerPart = buyWeightPerPartKg * materialPricePerKg;

  // Операции: расчет стоимости
  const ops = Array.isArray(state.operations) ? state.operations : [];
  let machineCostBatch = 0;
  let machineHoursTotal = 0;
  const opBreakdown = ops.map(op => {
    const setupMin = Math.max(0, Number(op.setupMinutes)||0);
    const cycleMin = Math.max(0, Number(op.cycleMinutes)||0);
    const rate = Math.max(0, Number(op.machineRatePerHour)||0);
    const shiftMult = (op.shift === "night" ? state.shiftMultipliers.night : state.shiftMultipliers.day) || 1;
    const effRate = rate * shiftMult;
    const setupHours = setupMin / 60;
    const cycleHoursBatch = (cycleMin * qty) / 60;
    const hoursTotal = setupHours + cycleHoursBatch;
    const cost = hoursTotal * effRate;
    machineCostBatch += cost;
    machineHoursTotal += hoursTotal;
    return { ...op, effRate, setupHours, cycleHoursBatch, hoursTotal, cost };
  });
  const machineCostPerPart = machineCostBatch / qty;

  // Доп. затраты
  const toolingPerPart = Math.max(0, Number(state.toolingPerPart) || 0);
  const toolingPerBatch = Math.max(0, Number(state.toolingPerBatch) || 0);
  const postPerPart = Math.max(0, Number(state.postProcessPerPart) || 0);
  const shippingPerBatch = Math.max(0, Number(state.shippingPerBatch) || 0);

  const addCostPerPart = toolingPerPart + postPerPart + (toolingPerBatch / qty) + (shippingPerBatch / qty);

  // Сумма до наценок
  const basePerPart = materialCostPerPart + machineCostPerPart + addCostPerPart;

  // Накладные
  const overheadPct = Math.max(0, Number(state.overheadPct) || 0) / 100;
  const withOverheadPerPart = basePerPart * (1 + overheadPct);

  // Маржа
  const marginPct = Math.max(0, Number(state.marginPct) || 0) / 100;
  const priceBeforeVATPerPart = withOverheadPerPart * (1 + marginPct);

  // НДС
  const vatPct = Math.max(0, Number(state.vatPct) || 0) / 100;
  const priceWithVATPerPart = priceBeforeVATPerPart * (1 + vatPct);

  const totalBatch = priceWithVATPerPart * qty;

  return {
    qty,
    material: {
      weightPerPartKg,
      scrapMultiplier,
      buyWeightPerPartKg,
      materialPricePerKg,
      materialCostPerPart,
    },
    machine: {
      operations: opBreakdown,
      machineHoursTotal,
      machineCostBatch,
      machineCostPerPart,
    },
    additional: {
      toolingPerPart,
      toolingPerBatch,
      postPerPart,
      shippingPerBatch,
      addCostPerPart,
    },
    pricing: {
      basePerPart,
      withOverheadPerPart,
      marginPct,
      priceBeforeVATPerPart,
      vatPct,
      priceWithVATPerPart,
      totalBatch,
    }
  };
}

function render(){
  const res = compute();
  const cur = state.currency || "₽";

  byId("unitPrice").textContent = formatMoney(res.pricing.priceWithVATPerPart, cur);
  byId("totalBatch").textContent = formatMoney(res.pricing.totalBatch, cur);

  const lines = [];
  lines.push(`Материал:`);
  lines.push(`  масса детали: ${res.material.weightPerPartKg.toFixed(3)} кг`);
  lines.push(`  запас/отход: ${(res.material.scrapMultiplier*100-100).toFixed(1)} %`);
  lines.push(`  закупочная масса: ${res.material.buyWeightPerPartKg.toFixed(3)} кг`);
  lines.push(`  цена за кг: ${formatMoney(res.material.materialPricePerKg, cur)}`);
  lines.push(`  стоимость материала/шт: ${formatMoney(res.material.materialCostPerPart, cur)}`);
  lines.push("");
  lines.push(`Операции:`);
  res.machine.operations.forEach((op, idx)=>{
    const typeLabel = opTypeLabel(op.type);
    lines.push(`  ${idx+1}) ${typeLabel}, смена: ${op.shift === 'night' ? 'ночь' : 'день'}`);
    lines.push(`     наладка: ${(op.setupHours*60).toFixed(0)} мин, цикл: ${(op.cycleHoursBatch*60/res.qty).toFixed(1)} мин/шт`);
    lines.push(`     ставка: ${formatMoney(op.effRate, cur)} /ч, часов: ${op.hoursTotal.toFixed(2)} ч, стоимость (партия): ${formatMoney(op.cost, cur)}`);
  });
  lines.push(`  итого часов: ${res.machine.machineHoursTotal.toFixed(2)} ч`);
  lines.push(`  стоимость машинного времени/шт: ${formatMoney(res.machine.machineCostPerPart, cur)}`);
  lines.push("");
  lines.push(`Доп. затраты:`);
  lines.push(`  инструмент/шт: ${formatMoney(res.additional.toolingPerPart, cur)}`);
  lines.push(`  оснастка/партия: ${formatMoney(res.additional.toolingPerBatch, cur)}`);
  lines.push(`  пост-обработка/шт: ${formatMoney(res.additional.postPerPart, cur)}`);
  lines.push(`  доставка/партия: ${formatMoney(res.additional.shippingPerBatch, cur)}`);
  lines.push(`  суммарно доп/шт: ${formatMoney(res.additional.addCostPerPart, cur)}`);
  lines.push("");
  lines.push(`Наценки:`);
  lines.push(`  накладные: ${(state.overheadPct||0).toFixed(1)} %`);
  lines.push(`  маржа: ${(state.marginPct||0).toFixed(1)} %`);
  lines.push(`  НДС: ${(state.vatPct||0).toFixed(1)} %`);
  lines.push("");
  lines.push(`Итог:`);
  lines.push(`  себестоимость/шт до наценок: ${formatMoney(res.pricing.basePerPart, cur)}`);
  lines.push(`  после накладных: ${formatMoney(res.pricing.withOverheadPerPart, cur)}`);
  lines.push(`  перед НДС: ${formatMoney(res.pricing.priceBeforeVATPerPart, cur)}`);
  lines.push(`  цена/шт с НДС: ${formatMoney(res.pricing.priceWithVATPerPart, cur)}`);
  lines.push(`  партия (${res.qty} шт): ${formatMoney(res.pricing.totalBatch, cur)}`);

  byId("breakdown").textContent = lines.join("\n");
}

function recalc(){ render(); }

function boot(){
  initMaterialSelect();
  syncInputsFromState();
  bindInputs();
  refreshPresetsSelect();
  recalc();
}

document.addEventListener("DOMContentLoaded", boot);

// ===== Операции UI =====
function opTypeLabel(type){
  switch(type){
    case "milling": return "Фрезеровка";
    case "turning": return "Токарная";
    case "drilling": return "Сверление";
    default: return "Другая";
  }
}

function renderOperations(){
  const container = byId("operationsList");
  const ops = state.operations || [];
  container.innerHTML = ops.map((op, i)=>{
    return `
      <div class="op" data-index="${i}">
        <select class="op-type">
          <option value="milling" ${op.type==="milling"?"selected":""}>Фрезеровка</option>
          <option value="turning" ${op.type==="turning"?"selected":""}>Токарная</option>
          <option value="drilling" ${op.type==="drilling"?"selected":""}>Сверление</option>
          <option value="other" ${op.type==="other"?"selected":""}>Другая</option>
        </select>
        <input class="op-setup" type="number" min="0" step="1" value="${op.setupMinutes}" placeholder="Наладка, мин" />
        <input class="op-cycle" type="number" min="0" step="0.1" value="${op.cycleMinutes}" placeholder="Цикл, мин/шт" />
        <input class="op-rate" type="number" min="0" step="1" value="${op.machineRatePerHour}" placeholder="Ставка, за час" />
        <div style="display:flex; gap:8px; align-items:center;">
          <select class="op-shift">
            <option value="day" ${op.shift==="day"?"selected":""}>День</option>
            <option value="night" ${op.shift==="night"?"selected":""}>Ночь</option>
          </select>
          <button class="btn remove" title="Удалить">×</button>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll('.op').forEach(row =>{
    const idx = Number(row.dataset.index);
    row.querySelector('.op-type').addEventListener('change', (e)=>{ state.operations[idx].type = e.target.value; saveState(); recalc(); });
    row.querySelector('.op-setup').addEventListener('input', (e)=>{ state.operations[idx].setupMinutes = Number(e.target.value)||0; saveState(); recalc(); });
    row.querySelector('.op-cycle').addEventListener('input', (e)=>{ state.operations[idx].cycleMinutes = Number(e.target.value)||0; saveState(); recalc(); });
    row.querySelector('.op-rate').addEventListener('input', (e)=>{ state.operations[idx].machineRatePerHour = Number(e.target.value)||0; saveState(); recalc(); });
    row.querySelector('.op-shift').addEventListener('change', (e)=>{ state.operations[idx].shift = e.target.value; saveState(); recalc(); });
    row.querySelector('.remove').addEventListener('click', ()=>{
      state.operations.splice(idx,1); saveState(); renderOperations(); recalc();
    });
  });
}

// ===== CSV =====
function buildCSV(){
  const res = compute();
  const cur = state.currency || "₽";
  const lines = [];
  lines.push(["Параметр","Значение"].join(','));
  lines.push(["Количество, шт", res.qty].join(','));
  lines.push(["Материал, кг/шт", res.material.weightPerPartKg.toFixed(3)].join(','));
  lines.push(["Отход, %", ((res.material.scrapMultiplier*100)-100).toFixed(1)].join(','));
  lines.push(["Закупочная масса, кг/шт", res.material.buyWeightPerPartKg.toFixed(3)].join(','));
  lines.push(["Цена материала, за кг", formatMoney(res.material.materialPricePerKg, cur)].join(','));
  lines.push(["Материал/шт", formatMoney(res.material.materialCostPerPart, cur)].join(','));
  lines.push(["", ""].join(','));
  lines.push(["Операции", ""].join(','));
  res.machine.operations.forEach((op, i)=>{
    lines.push([`${i+1}) ${opTypeLabel(op.type)} (${op.shift==='night'?'ночь':'день'})`, ""].join(','));
    lines.push(["  Наладка, мин", (op.setupHours*60).toFixed(0)].join(','));
    lines.push(["  Цикл, мин/шт", (op.cycleHoursBatch*60/res.qty).toFixed(1)].join(','));
    lines.push(["  Ставка, за час", formatMoney(op.effRate, cur)].join(','));
    lines.push(["  Стоимость, партия", formatMoney(op.cost, cur)].join(','));
  });
  lines.push(["Итого часов", res.machine.machineHoursTotal.toFixed(2)].join(','));
  lines.push(["Машинное время/шт", formatMoney(res.machine.machineCostPerPart, cur)].join(','));
  lines.push(["", ""].join(','));
  lines.push(["Инструмент/шт", formatMoney(res.additional.toolingPerPart, cur)].join(','));
  lines.push(["Оснастка/партия", formatMoney(res.additional.toolingPerBatch, cur)].join(','));
  lines.push(["Пост-обработка/шт", formatMoney(res.additional.postPerPart, cur)].join(','));
  lines.push(["Доставка/партия", formatMoney(res.additional.shippingPerBatch, cur)].join(','));
  lines.push(["Доп. затраты/шт", formatMoney(res.additional.addCostPerPart, cur)].join(','));
  lines.push(["", ""].join(','));
  lines.push(["Себестоимость/шт", formatMoney(res.pricing.basePerPart, cur)].join(','));
  lines.push(["После накладных/шт", formatMoney(res.pricing.withOverheadPerPart, cur)].join(','));
  lines.push(["Цена до НДС/шт", formatMoney(res.pricing.priceBeforeVATPerPart, cur)].join(','));
  lines.push(["Цена с НДС/шт", formatMoney(res.pricing.priceWithVATPerPart, cur)].join(','));
  lines.push([`Итого, партия (${res.qty} шт)`, formatMoney(res.pricing.totalBatch, cur)].join(','));
  const csv = lines.join('\n');
  const filename = `cnc-estimate-${new Date().toISOString().slice(0,10)}.csv`;
  return { csv, filename };
}

// ===== Печать КП =====
function openPrintWindow(){
  const res = compute();
  const cur = state.currency || "₽";
  const w = window.open("", "printwin");
  if(!w) return;
  const style = `
    <style>
      body{ font-family: Arial, sans-serif; color:#111; padding:24px; }
      h1{ font-size:20px; margin:0 0 8px; }
      h2{ font-size:16px; margin:16px 0 8px; }
      table{ border-collapse: collapse; width:100%; }
      th,td{ border:1px solid #ccc; padding:6px 8px; text-align:left; }
      tfoot td{ font-weight:bold; }
      small{ color:#666 }
    </style>`;
  const rowsOps = res.machine.operations.map((op,i)=>{
    return `<tr>
      <td>${i+1}</td>
      <td>${opTypeLabel(op.type)} (${op.shift==='night'?'ночь':'день'})</td>
      <td>${(op.setupHours*60).toFixed(0)}</td>
      <td>${(op.cycleHoursBatch*60/res.qty).toFixed(1)}</td>
      <td>${op.hoursTotal.toFixed(2)}</td>
      <td>${formatMoney(op.effRate, cur)}</td>
      <td>${formatMoney(op.cost, cur)}</td>
    </tr>`;
  }).join('');
  const html = `
    <html><head><meta charset="utf-8"><title>Коммерческое предложение</title>${style}</head>
    <body>
      <h1>Коммерческое предложение</h1>
      <small>Дата: ${new Date().toLocaleString()}</small>
      <h2>Параметры</h2>
      <table>
        <tr><td>Количество, шт</td><td>${res.qty}</td></tr>
        <tr><td>Материал, кг/шт</td><td>${res.material.weightPerPartKg.toFixed(3)}</td></tr>
        <tr><td>Отход, %</td><td>${((res.material.scrapMultiplier*100)-100).toFixed(1)}</td></tr>
        <tr><td>Закупочная масса, кг/шт</td><td>${res.material.buyWeightPerPartKg.toFixed(3)}</td></tr>
        <tr><td>Материал/шт</td><td>${formatMoney(res.material.materialCostPerPart, cur)}</td></tr>
      </table>
      <h2>Операции</h2>
      <table>
        <thead><tr><th>#</th><th>Операция</th><th>Наладка, мин</th><th>Цикл, мин/шт</th><th>Часы, партия</th><th>Ставка/ч</th><th>Стоимость, партия</th></tr></thead>
        <tbody>${rowsOps}</tbody>
        <tfoot>
          <tr><td colspan="6">Итого машинное время, партия</td><td>${formatMoney(res.machine.machineCostBatch, cur)}</td></tr>
        </tfoot>
      </table>
      <h2>Итоги</h2>
      <table>
        <tr><td>Доп. затраты/шт</td><td>${formatMoney(res.additional.addCostPerPart, cur)}</td></tr>
        <tr><td>Себестоимость/шт</td><td>${formatMoney(res.pricing.basePerPart, cur)}</td></tr>
        <tr><td>После накладных/шт</td><td>${formatMoney(res.pricing.withOverheadPerPart, cur)}</td></tr>
        <tr><td>Цена до НДС/шт</td><td>${formatMoney(res.pricing.priceBeforeVATPerPart, cur)}</td></tr>
        <tr><td>Цена с НДС/шт</td><td>${formatMoney(res.pricing.priceWithVATPerPart, cur)}</td></tr>
        <tr><td><strong>Итого, партия (${res.qty} шт)</strong></td><td><strong>${formatMoney(res.pricing.totalBatch, cur)}</strong></td></tr>
      </table>
      <script>window.print();</script>
    </body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ===== Быстрый калькулятор (токарка) =====
function quickCalcTurning(){
  // Считываем геометрию и опции
  const mat = (byId('qcMat')?.value)||'steel';
  const partType = (byId('qcPartType')?.value)||'rod';
  const L = Number(byId('qcLen')?.value)||0; // мм
  const D = Number(byId('qcDia')?.value)||0; // мм
  const Thk = Number(byId('qcThk')?.value)||0; // мм

  const L_od = Number(byId('qcLOd')?.value)||0;
  const L_id = Number(byId('qcLId')?.value)||0;
  const nThreadIn = Number(byId('qcThreadIn')?.value)||0;
  const nThreadOutSmall = Number(byId('qcThreadOutSmall')?.value)||0;
  const nThreadOutBig = Number(byId('qcThreadOutBig')?.value)||0;
  const nDrill = Number(byId('qcDrill')?.value)||0;
  const nKeyway = Number(byId('qcKeyway')?.value)||0;
  const nTaperIn = Number(byId('qcTaperIn')?.value)||0;
  const nTaperOut = Number(byId('qcTaperOut')?.value)||0;
  const nSphere = Number(byId('qcSphere')?.value)||0;
  const nKnurl = Number(byId('qcKnurl')?.value)||0;
  const IT = Number(byId('qcIT')?.value)||12;
  const Ra = Number(byId('qcRa')?.value)||3.2;
  const qty = Math.max(1, Number(byId('qcQty')?.value)||state.quantity||1);

  // Сегменты OD/ID
  const ODAll = byId('qcODAll')?.checked || false;
  const od1 = { D:Number(byId('qcOD1D')?.value)||0, L:Number(byId('qcOD1L')?.value)||0, N:Number(byId('qcOD1N')?.value)||0 };
  const od2 = { D:Number(byId('qcOD2D')?.value)||0, L:Number(byId('qcOD2L')?.value)||0, N:Number(byId('qcOD2N')?.value)||0 };
  const od3 = { D:Number(byId('qcOD3D')?.value)||0, L:Number(byId('qcOD3L')?.value)||0, N:Number(byId('qcOD3N')?.value)||0 };
  const id1 = { D:Number(byId('qcIDD')?.value)||0, L:Number(byId('qcIDL')?.value)||0, N:Number(byId('qcIDN')?.value)||0 };
  const fitsN = Number(byId('qcFits')?.value)||0;

  // Эмпирические коэффициенты (на основе открытых калькуляторов-подходов, ориентировочно)
  // Материал: корректируем скорость/трудоемкость
  const matMult = {
    steel: 1.0,
    stainless: 1.25,
    aluminum: 0.8,
    brass: 0.85,
    bronze: 0.95,
    titanium: 1.6,
  }[mat] || 1.0;

  // Квалитет и шероховатость влияют на доп. проходы и подачу
  const itMult = IT <= 6 ? 1.35 : IT <= 8 ? 1.2 : IT <= 10 ? 1.1 : 1.0;
  const raMult = Ra <= 0.8 ? 1.35 : Ra <= 1.6 ? 1.2 : Ra <= 3.2 ? 1.1 : 1.0;

  // Базовые оценки времени (мин): наладка + цикл
  let setupMin = 10; // базовая наладка
  setupMin += partType === 'flange' ? 10 : partType === 'pipe' ? 8 : 5;
  setupMin *= 1.0 * matMult; // материал влияет и на наладку условно

  let cycleMin = 0;
  // Наружное точение: 0.015 мин/мм по суммарной длине при D~50 (ориентир), масштабируем по диаметру
  const scaleD = Math.max(0.5, Math.min(2.0, D / 50));
  // Если выбран "общий диаметр" — считаем по полной длине L
  const L_od_effective = ODAll ? Math.max(L, L_od) : L_od;
  cycleMin += 0.015 * L_od_effective * scaleD;
  // Внутреннее точение медленнее
  cycleMin += 0.022 * L_id * scaleD;

  // Дополнительные сегменты OD/ID (если заданы)
  const segs = [od1, od2, od3].filter(s=>s.D>0 && s.L>0 && s.N>0);
  segs.forEach(s=>{
    const sScale = Math.max(0.5, Math.min(2.0, s.D/50));
    cycleMin += 0.014 * s.L * s.N * sScale; // чуть быстрее основного OD ориентир
  });
  if(id1.D>0 && id1.L>0 && id1.N>0){
    const sScale = Math.max(0.5, Math.min(2.0, id1.D/50));
    cycleMin += 0.021 * id1.L * id1.N * sScale;
  }
  // Сверления и прочие операции (условные нормы)
  cycleMin += nDrill * 0.8;
  cycleMin += nKeyway * 2.0;
  cycleMin += nTaperIn * 1.2 + nTaperOut * 1.2;
  cycleMin += nSphere * 1.8;
  cycleMin += nKnurl * 1.5;
  cycleMin += nThreadIn * 1.2;
  cycleMin += nThreadOutSmall * 1.0 + nThreadOutBig * 1.8;
  cycleMin += fitsN * 0.9; // точные посадки

  // Материал, квалитет, шероховатость
  cycleMin *= matMult * itMult * raMult;

  // Авто-масса по геометрии если включено
  const autoMass = byId('qcAutoMass');
  if(autoMass?.checked){
    const density = {
      steel: 7.85,
      stainless: 7.9,
      aluminum: 2.75,
      brass: 8.4,
      bronze: 8.8,
      titanium: 4.43,
    }[mat] || 7.85; // г/см³

    let volume_mm3 = 0; // мм³
    const pi = Math.PI;
    if(partType === 'rod'){
      volume_mm3 = pi * (D*D/4) * L;
    }else if(partType === 'flange'){
      volume_mm3 = pi * (D*D/4) * Thk;
    }else if(partType === 'pipe'){
      const Di = Math.max(0, D - 2*Thk);
      volume_mm3 = pi * ((D*D - Di*Di)/4) * L;
    }
    const volume_cm3 = volume_mm3 / 1000; // мм³ -> см³
    const mass_kg = (volume_cm3 * density) / 1000; // г -> кг
    if(Number.isFinite(mass_kg) && mass_kg >= 0){
      state.partWeight = mass_kg;
      const pw = byId('partWeight');
      if(pw) pw.value = state.partWeight;
      saveState();
    }
  }

  return { setupMin, cycleMin };
}

// ===== Быстрый калькулятор (фрезеровка) =====
function quickCalcMilling(){
  const mat = (byId('qcMat')?.value)||'steel';
  const X = Number(byId('qcX')?.value)||0; // мм
  const Y = Number(byId('qcY')?.value)||0; // мм
  const Z = Number(byId('qcZ')?.value)||0; // мм

  const faces = Number(byId('qcFaces')?.value)||0;
  const pockets = Number(byId('qcPockets')?.value)||0;
  const holes = Number(byId('qcHoles')?.value)||0;
  const threads = Number(byId('qcThreads')?.value)||0;
  const perimeter = Number(byId('qcPerimeter')?.value)||0; // мм
  const IT = Number(byId('qcIT_m')?.value)||12;
  const Ra = Number(byId('qcRa_m')?.value)||3.2;

  const matMult = {
    steel: 1.0,
    stainless: 1.3,
    aluminum: 0.7,
    brass: 0.85,
    bronze: 0.95,
    titanium: 1.8,
  }[mat] || 1.0;

  const itMult = IT <= 6 ? 1.35 : IT <= 8 ? 1.2 : IT <= 10 ? 1.1 : 1.0;
  const raMult = Ra <= 0.8 ? 1.35 : Ra <= 1.6 ? 1.2 : Ra <= 3.2 ? 1.1 : 1.0;

  // Базовая наладка
  let setupMin = 15 * matMult;

  let cycleMin = 0;
  // Плоскости: 0.06 мин/см² на сторону ориентировочно
  const areaXY_cm2 = (X*Y)/100; // мм² -> см²
  cycleMin += faces * 0.06 * areaXY_cm2;
  // Карманы: 0.8 мин/карман + 0.02 мин/мм глубины, предположим глубина ~ Z/2
  cycleMin += pockets * (0.8 + 0.02 * (Z/2));
  // Отверстия: 0.4 мин/шт
  cycleMin += holes * 0.4;
  // Резьбы: 0.9 мин/шт
  cycleMin += threads * 0.9;
  // Контур: 0.004 мин/мм контура
  cycleMin += 0.004 * perimeter;

  cycleMin *= matMult * itMult * raMult;

  // Авто-масса по геометрии если включено
  const autoMass = byId('qcAutoMass');
  if(autoMass?.checked){
    // Плотности, г/см³
    const density = {
      steel: 7.85,
      stainless: 7.9,
      aluminum: 2.75,
      brass: 8.4,
      bronze: 8.8,
      titanium: 4.43,
    }[mat] || 7.85;
    const volume_cm3 = (X * Y * Z) / 1000; // мм³ -> см³
    const mass_kg = (volume_cm3 * density) / 1000; // г -> кг
    state.partWeight = Math.max(0, mass_kg);
    byId('partWeight').value = state.partWeight;
    saveState();
  }

  return { setupMin, cycleMin };
}

// ===== Пресеты =====
function getPresets(){
  try{
    return JSON.parse(localStorage.getItem('cnc_estimator_presets_v1')||"{}") || {};
  }catch{ return {}; }
}
function savePreset(name, snapshot){
  const presets = getPresets();
  presets[name] = snapshot;
  localStorage.setItem('cnc_estimator_presets_v1', JSON.stringify(presets));
}
function refreshPresetsSelect(){
  const sel = byId('presetSelect');
  const presets = getPresets();
  const names = Object.keys(presets);
  sel.innerHTML = names.length ? names.map(n=>`<option value="${n}">${n}</option>`).join('') : '<option value="">(нет пресетов)</option>';
}
function snapshotState(){
  // Сохраняем только пользовательские поля
  const {
    quantity, currency,
    materialKey, materialPrice, partWeight, scrapRate,
    operations, shiftMultipliers,
    toolingPerPart, toolingPerBatch, postProcessPerPart, shippingPerBatch,
    overheadPct, marginPct, vatPct,
  } = state;
  return {
    quantity, currency,
    materialKey, materialPrice, partWeight, scrapRate,
    operations, shiftMultipliers,
    toolingPerPart, toolingPerBatch, postProcessPerPart, shippingPerBatch,
    overheadPct, marginPct, vatPct,
  };
}


