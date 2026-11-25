(() => {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/chat-widget.css';
  document.head.appendChild(stylesheet);

  const launcher = document.createElement('button');
  launcher.className = 'ai-chat-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'פתיחת צ׳אט עם Gemini');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">forum</span><span>שוחח עם Gemini</span>';

  const panel = document.createElement('section');
  panel.className = 'ai-chat-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'צ׳אט עם Gemini');
  panel.innerHTML = `
    <header class="ai-chat-header">
      <div>
        <strong>עוזר AI</strong>
        <span>מחובר ל-Gemini</span>
      </div>
      <button class="ai-chat-close" type="button" aria-label="סגירת הצ׳אט">×</button>
    </header>
    <nav class="ai-chat-modes" aria-label="אפשרויות">
      <button type="button" class="ai-chat-mode ai-chat-mode-active" data-mode="chat" aria-pressed="true">דבר עם הסוכן</button>
      <button type="button" class="ai-chat-mode" data-mode="report" aria-pressed="false">סימון נקודה חשודה במסך</button>
      <button type="button" class="ai-chat-mode" data-mode="recipes" aria-pressed="false">מתכונים</button>
    </nav>
    <div class="ai-chat-view" data-view="chat">
      <div class="ai-chat-messages" role="log" aria-live="polite">
        <div class="ai-chat-message ai-chat-assistant">שלום! איך אוכל לעזור?</div>
      </div>
      <form class="ai-chat-form">
        <textarea aria-label="הודעה" placeholder="כתבו הודעה..." rows="1" maxlength="5000" required></textarea>
        <button type="submit" aria-label="שליחת הודעה"><span class="material-symbols-outlined" aria-hidden="true">send</span></button>
      </form>
    </div>
    <div class="ai-chat-view ai-chat-report-view" data-view="report" hidden>
      <div class="ai-chat-message ai-chat-assistant">מה המיקום של הנקודה החשודה?</div>
      <form class="ai-chat-report-form">
        <input aria-label="מיקום הנקודה החשודה" name="city" type="text" placeholder="כתובת, יישוב או קואורדינטות" maxlength="300" required>
        <button type="submit">שליחת מיקום</button>
      </form>
    </div>
    <div class="ai-chat-view ai-chat-recipes-view" data-view="recipes" hidden>
      <div class="ai-chat-messages ai-chat-recipes-messages" role="log" aria-live="polite">
        <div class="ai-chat-message ai-chat-assistant">איזה שפים תרצה?</div>
      </div>
      <form class="ai-chat-recipes-form">
        <input aria-label="שפים למתכון" name="chefs" type="text" placeholder="כתבו את שמות השפים" maxlength="300" required>
        <button type="submit">שליחה</button>
      </form>
    </div>
    <div class="ai-chat-status" role="status"></div>
  `;
  document.body.append(launcher, panel);

  const messagesElement = panel.querySelector('.ai-chat-messages');
  const form = panel.querySelector('.ai-chat-form');
  const input = form.querySelector('textarea');
  const sendButton = form.querySelector('button');
  const status = panel.querySelector('.ai-chat-status');
  const reportForm = panel.querySelector('.ai-chat-report-form');
  const reportInput = reportForm.querySelector('input');
  const reportButton = reportForm.querySelector('button');
  const recipesMessages = panel.querySelector('.ai-chat-recipes-messages');
  const recipesForm = panel.querySelector('.ai-chat-recipes-form');
  const recipesInput = recipesForm.querySelector('input');
  const recipesButton = recipesForm.querySelector('button');
  const modeButtons = [...panel.querySelectorAll('.ai-chat-mode')];
  const history = [];
  let pending = false;
  let reportPending = false;
  let recipesPending = false;
  let currentMode = 'chat';

  function setMode(mode) {
    currentMode = mode;
    panel.querySelectorAll('.ai-chat-view').forEach(view => {
      view.hidden = view.dataset.view !== mode;
    });
    modeButtons.forEach(button => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('ai-chat-mode-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    status.textContent = '';
    if (mode === 'report') reportInput.focus();
    else if (mode === 'recipes') recipesInput.focus();
    else input.focus();
  }

  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      const activeInput = currentMode === 'report' ? reportInput : currentMode === 'recipes' ? recipesInput : input;
      activeInput.focus();
    }
    else launcher.focus();
  }

  function appendMessage(text, role, className) {
    const message = document.createElement('div');
    message.className = `ai-chat-message ${className}`;
    message.textContent = text;
    messagesElement.appendChild(message);
    messagesElement.scrollTop = messagesElement.scrollHeight;
    if (role) history.push({ role, parts: [{ text }] });
    return message;
  }

  function appendRecipeMessage(text, className) {
    const message = document.createElement('div');
    message.className = `ai-chat-message ${className}`;
    message.textContent = text;
    recipesMessages.appendChild(message);
    recipesMessages.scrollTop = recipesMessages.scrollHeight;
    return message;
  }

  launcher.addEventListener('click', () => setOpen(panel.hidden));
  panel.querySelector('.ai-chat-close').addEventListener('click', () => setOpen(false));
  modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  recipesForm.addEventListener('submit', async event => {
    event.preventDefault();
    const chefs = recipesInput.value.trim();
    if (!chefs || recipesPending) return;

    recipesPending = true;
    recipesButton.disabled = true;
    status.textContent = 'מכין תשובה...';
    const userMessage = appendRecipeMessage(chefs, 'ai-chat-user');
    const waiting = appendRecipeMessage('...', 'ai-chat-assistant ai-chat-waiting');

    try {
      const response = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ chefs })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'לא ניתן לקבל תשובה כרגע.');
      if (typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('לא התקבלה תשובה מ-Make.');
      waiting.className = 'ai-chat-message ai-chat-assistant';
      waiting.textContent = result.reply.trim();
      recipesForm.reset();
      status.textContent = '';
    } catch (error) {
      waiting.remove();
      userMessage.remove();
      recipesInput.value = chefs;
      status.textContent = error.message || 'שגיאה בשליחת הבקשה.';
    } finally {
      recipesPending = false;
      recipesButton.disabled = false;
      recipesInput.focus();
    }
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  reportForm.addEventListener('submit', async event => {
    event.preventDefault();
    const city = reportInput.value.trim();
    if (!city || reportPending) return;

    reportPending = true;
    reportButton.disabled = true;
    status.textContent = 'שולח את המיקום...';
    try {
      const response = await fetch('/api/suspicious-point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ city })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'לא ניתן לשלוח את המיקום כרגע.');
      reportForm.reset();
      status.textContent = 'המיקום נשלח בהצלחה.';
    } catch (error) {
      status.textContent = error.message || 'שגיאה בשליחת המיקום.';
    } finally {
      reportPending = false;
      reportButton.disabled = false;
      reportInput.focus();
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || pending) return;

    input.value = '';
    const userMessage = appendMessage(text, 'user', 'ai-chat-user');
    pending = true;
    sendButton.disabled = true;
    status.textContent = 'Gemini מקליד...';
    const waiting = appendMessage('...', null, 'ai-chat-assistant ai-chat-waiting');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ contents: history.slice(-24) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'לא ניתן לקבל תשובה כרגע.');
      waiting.remove();
      appendMessage(result.reply, 'model', 'ai-chat-assistant');
      status.textContent = '';
    } catch (error) {
      waiting.remove();
      userMessage.remove();
      history.pop();
      input.value = text;
      status.textContent = error.message || 'שגיאה בשליחת ההודעה.';
    } finally {
      pending = false;
      sendButton.disabled = false;
      input.focus();
    }
  });
})();
