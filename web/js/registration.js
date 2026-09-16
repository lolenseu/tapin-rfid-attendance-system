const registrationForm = document.getElementById('employeeRegistrationForm');
const registrationMessage = document.getElementById('registrationMessage');
const registrationApiBaseUrl = (window.TAPIN_API_URL || '').replace(/\/+$/, '');

if (registrationForm) {
    registrationForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        registrationMessage.textContent = 'Registering user...';

        const formData = new FormData(registrationForm);

        try {
            const response = await fetch(`${registrationApiBaseUrl}/api/register-employee`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            const result = await response.json();

            if (!response.ok || result.status !== 'success') {
                throw new Error(result.message || 'Registration failed.');
            }

            registrationMessage.textContent = `Registered successfully. UID: ${result.data.uid}`;
            registrationForm.reset();
        } catch (error) {
            registrationMessage.textContent = error.message || 'Unable to connect to the server.';
        }
    });
}
