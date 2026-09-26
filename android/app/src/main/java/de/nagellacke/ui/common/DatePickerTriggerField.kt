package de.nagellacke.ui.common

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier

/**
 * A read-only field showing a date that opens a picker when used (#359).
 *
 * Both date fields used to be `enabled = false` plus a `clickable` modifier. That looked right
 * and worked by touch, but disabled is exactly the state TalkBack reads as "not available" and
 * declines to activate, so the picker was unreachable with a screen reader. The field now stays
 * enabled and read-only: a tap anywhere on it still opens the picker (via its interaction
 * source), and the trailing icon button is a labelled, focusable action for accessibility
 * services.
 */
@Composable
fun DatePickerTriggerField(
    value: String,
    label: String,
    onPick: () -> Unit,
    modifier: Modifier = Modifier.fillMaxWidth(),
) {
    val currentOnPick = rememberUpdatedState(onPick)
    val interactions = remember { MutableInteractionSource() }
    LaunchedEffect(interactions) {
        interactions.interactions.collect { if (it is PressInteraction.Release) currentOnPick.value() }
    }
    OutlinedTextField(
        value = value,
        onValueChange = {},
        label = { Text(label) },
        readOnly = true,
        singleLine = true,
        interactionSource = interactions,
        trailingIcon = {
            IconButton(onClick = { currentOnPick.value() }) {
                Icon(Icons.Filled.DateRange, contentDescription = "$label wählen")
            }
        },
        modifier = modifier,
    )
}
