// Get the contact form
let form = document.querySelector("form");

// Add an event listener to the form's submit event
form.addEventListener("submit", function(event) {
  event.preventDefault();

  // Get the form input values
  let name = document.querySelector("#name").value;
  let email = document.querySelector("#email").value;
  let message = document.querySelector("#message").value;

  // Perform form validation
  if (name === "" || email === "" || message === "") {
    alert("Please fill out all fields");
    return;
  }

  // Send the form data to the server
  // (in a real application, this would typically involve using a JavaScript library or framework to make an AJAX request)
  alert(`Thank you ${name}, your message has been sent!`);

  // Reset the form fields
  form.reset();
});
