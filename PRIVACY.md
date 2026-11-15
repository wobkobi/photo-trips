# Privacy policy

_Last updated: 15 November 2026_

Pic Cabinet is a Windows app made by To the Point Tech. This policy explains what the app does
with your information.

**In short:** your photos, and everything Pic Cabinet works out about them, stay on your PC. We
don't collect, receive, store or sell any of it. The app has no accounts, analytics, advertising
or tracking. The only thing it does online on its own is check for updates.

## What the app reads

To sort your library, Pic Cabinet reads the photos and videos in your library folder, in the inbox
folders you choose, and in the folders, memory cards and phones you import from. Phones are only
ever read, never written to. From each file it reads:

- its name, size and file dates
- when it was taken, from the details stored inside the photo or video
- where it was taken, if the file has GPS coordinates

It also works out a fingerprint (a hash) of each file's contents, to spot identical copies.

When you look at a photo or video full size, the app also reads the camera or phone it was taken
with, its size in pixels, and the camera's settings, to show beside it. These are read again
each time and not kept.

Locations are used to suggest trips, to name the places in them, and to show on a map where a
photo was taken. Place names and the map come from data built into the app, so locations are
never looked up online and never leave your PC, unless you choose "Open in OpenStreetMap" (see
below).

## What the app stores

Everything Pic Cabinet keeps is stored on your PC, in your Windows account, in
`%LOCALAPPDATA%\com.wobkobi.phototrips`:

- `library.db`: the index of your library, your trips, settings, and the history of every move
  so it can be undone
- thumbnail and preview images, so the library opens quickly
- `logs`: a short record of problems the app ran into, which can include file and folder names.
  It's capped at a few small files, and you can open the folder from Help > Log folder.

None of this is sent to us or anyone else, and we can't see it. If you start Pic Cabinet with
Windows, Windows keeps a startup entry for it, which you can turn off in Settings or in Windows.

## What the app sends over the internet

**Update checks.** About a minute after it starts, and then once a day, Pic Cabinet downloads a
small file from GitHub (github.com) that names the latest version. You can also check from
Settings > About or Help > Check for updates. If you choose to install an update, the installer
is downloaded from GitHub too. These requests contain nothing about you, your photos or your
library. As with any web request, GitHub receives your IP address and basic technical details,
and handles them under the [GitHub Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
We don't receive this information.

**Links you choose to open.** Some buttons open a page outside the app, such as a Microsoft Store
page for a Windows image extension, or this policy. Those open in the Store app or your web
browser, and that service's own privacy policy applies.

**Open in OpenStreetMap.** Beside a photo that has a location, this button opens
openstreetmap.org in your web browser at the spot where the photo was taken, so OpenStreetMap
receives that location. It's sent only when you click the button, and only for that one photo.
The [OpenStreetMap privacy policy](https://osmfoundation.org/wiki/Privacy_Policy) applies.

Nothing else is sent anywhere.

## Notifications and the Recycle Bin

Notifications, such as a memory card being ready to import, are shown by Windows on your PC.
Duplicates you clear out go to the Windows Recycle Bin, where they stay until you empty it.

## Removing your information

Uninstalling Pic Cabinet removes the app. When you uninstall you can choose to delete the app's
data as well; otherwise, delete the `%LOCALAPPDATA%\com.wobkobi.phototrips` folder yourself. Your
photos stay where they are in your library.

## Your rights

Because the app sends us nothing, we hold no personal information from it. If you email us, we
use your email address and message only to reply, and keep them only as long as that takes.
Under the New Zealand Privacy Act 2020 you can ask us what personal information we hold about
you and ask us to correct it. If you're not happy with how we've handled a privacy concern, you
can complain to the [Office of the Privacy Commissioner](https://www.privacy.org.nz).

## Changes to this policy

If what the app does with your information changes, we'll update this policy and the date at
the top before the change ships. Earlier versions are in this repository's history.

## Contact

To the Point Tech
[tothepoint.co.nz](https://www.tothepoint.co.nz) - harrison@tothepoint.co.nz
