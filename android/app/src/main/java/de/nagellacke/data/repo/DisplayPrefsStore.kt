package de.nagellacke.data.repo

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Persists display-related user preferences in plain SharedPreferences.
 * Exposes reactive StateFlows so ViewModels can combine them directly.
 */
@Singleton
class DisplayPrefsStore @Inject constructor(@ApplicationContext context: Context) {
    private val prefs = context.getSharedPreferences("display_prefs", Context.MODE_PRIVATE)

    // true  = draw the nail-bottle SVG on polish cards
    // false = show a plain color swatch
    private val _bottleStyle = MutableStateFlow(prefs.getBoolean(KEY_BOTTLE_STYLE, true))
    val bottleStyle: StateFlow<Boolean> = _bottleStyle.asStateFlow()

    fun setBottleStyle(value: Boolean) {
        _bottleStyle.value = value
        prefs.edit().putBoolean(KEY_BOTTLE_STYLE, value).apply()
    }

    private companion object {
        const val KEY_BOTTLE_STYLE = "bottle_style"
    }
}
