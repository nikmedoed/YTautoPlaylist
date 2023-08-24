//// Saves options to chrome.storage
//function save_options() {
//    var color = document.getElementById('color').value;
//    var likesColor = document.getElementById('like').checked;
//    chrome.storage.sync.set({
//        favoriteColor: color,
//        likesColor: likesColor
//    }, function() {
//        // Update status to let user know options were saved.
//        var status = document.getElementById('status');
//        status.textContent = 'Options saved.';
//        setTimeout(function() {
//        status.textContent = '';
//        }, 750);
//    });
//}
//
//// Restores select box and checkbox state using the preferences
//// stored in chrome.storage.
//    function restore_options() {
//    // Use default value color = 'red' and likesColor = true.
//    chrome.storage.sync.get({
//        favoriteColor: 'red',
//        likesColor: true
//    }, function(items) {
//        document.getElementById('color').value = items.favoriteColor;
//        document.getElementById('like').checked = items.likesColor;
//    });
//}
//
//document.addEventListener('DOMContentLoaded', restore_options);
//document.getElementById('save').addEventListener('click',save_options);

// $(function () {
//     $('[data-toggle="popover"]').popover()
//   })


// (function () {
//     'use strict'
  
//     window.addEventListener('load', function () {
//       // Fetch all the forms we want to apply custom Bootstrap validation styles to
//       var forms = document.getElementsByClassName('needs-validation')
  
//       // Loop over them and prevent submission
//       Array.prototype.filter.call(forms, function (form) {
//         form.addEventListener('submit', function (event) {
//           if (form.checkValidity() === false) {
//             event.preventDefault()
//             event.stopPropagation()
//           }
//           form.classList.add('was-validated')
//         }, false)
//       })
//     }, false)
//   }())
  


// "options_ui": {
//     "page": "settings/settings.html",
//     "open_in_tab": false
// },